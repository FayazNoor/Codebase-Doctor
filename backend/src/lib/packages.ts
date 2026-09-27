/**
 * Dependency upgrade mechanics: plan package.json edits for the whole package
 * family, run the repo's package manager, and verify what actually got
 * installed in node_modules.
 *
 * Only packages already declared in package.json are touched: the target
 * package, its lock-step companions (react-dom, react-test-renderer) and its
 * type packages (@types/react, @types/react-dom). Unrelated dependencies are
 * never changed.
 *
 * The command runner is injectable (setCommandRunner) so tests can exercise
 * the full flow without network access.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolveEcosystem, parseMajor, satisfiesCaret } from "./ecosystem.js";
import type { PackageChange, PeerConflict } from "../types.js";

export type PackageManager = "npm" | "yarn" | "pnpm";

export const LOCKFILES: Record<PackageManager, string> = {
  npm: "package-lock.json",
  yarn: "yarn.lock",
  pnpm: "pnpm-lock.yaml",
};

// ---------------------------------------------------------------------------
// Command runner (injectable for tests)
// ---------------------------------------------------------------------------

export interface CommandResult {
  ok: boolean;
  output: string;
}
export type CommandRunner = (cmd: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv) => CommandResult;

/** Only plain tokens (package-manager names and flags) are ever passed to the runner. */
const SAFE_TOKEN = /^[A-Za-z0-9@._/:=-]+$/;

const defaultRunner: CommandRunner = (cmd, args, cwd, env) => {
  if (![cmd, ...args].every((t) => SAFE_TOKEN.test(t))) {
    return { ok: false, output: `Refusing to run a command with unexpected characters: ${[cmd, ...args].join(" ")}` };
  }
  // On Windows, npm/yarn/pnpm are .cmd shims that need cmd.exe. Invoke it
  // explicitly with the validated tokens instead of `shell: true` + args
  // (which Node concatenates without escaping — DEP0190).
  const isWindows = process.platform === "win32";
  const file = isWindows ? process.env["ComSpec"] || "cmd.exe" : cmd;
  const fileArgs = isWindows ? ["/d", "/s", "/c", `"${[cmd, ...args].join(" ")}"`] : args;
  const r = spawnSync(file, fileArgs, {
    cwd,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 10 * 60_000,
    env: { ...process.env, CI: "true", ...env },
    windowsVerbatimArguments: isWindows,
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (r.error) {
    const code = (r.error as NodeJS.ErrnoException).code ?? "";
    return { ok: false, output: `${output}${code === "ETIMEDOUT" ? "install timed out after 10 minutes" : `${code} ${r.error.message}`}`.trim() };
  }
  return { ok: r.status === 0, output };
};

let runner: CommandRunner = defaultRunner;

/** Override how install commands run (tests). Pass null to restore the default. */
export function setCommandRunner(r: CommandRunner | null): void {
  runner = r ?? defaultRunner;
}

// ---------------------------------------------------------------------------
// Package manager detection
// ---------------------------------------------------------------------------

export interface PackageManagerInfo {
  pm: PackageManager;
  /** Why this manager was chosen. */
  reason: string;
  warnings: string[];
}

/**
 * Pick the repo's package manager: the `packageManager` field (corepack) wins,
 * then the lockfile. Throws for managers the tools cannot drive (bun, Yarn
 * Plug'n'Play without node_modules).
 */
export function detectPackageManager(repoPath: string): PackageManagerInfo {
  const has = (f: string) => fs.existsSync(path.join(repoPath, f));
  const pkg = readPkg(repoPath) ?? {};
  const field = typeof pkg["packageManager"] === "string" ? (pkg["packageManager"] as string) : null;
  const warnings: string[] = [];

  if (has("bun.lockb") || has("bun.lock") || field?.startsWith("bun@")) {
    throw new Error("This repository uses bun, which Codebase Doctor does not support yet (supported: npm, yarn, pnpm).");
  }
  if (has(".pnp.cjs") || has(".pnp.js")) {
    throw new Error(
      "This repository uses Yarn Plug'n'Play (no node_modules), so installed versions cannot be verified. " +
        "Set `nodeLinker: node-modules` in .yarnrc.yml to use Codebase Doctor with it."
    );
  }

  const lockfiles = (Object.entries(LOCKFILES) as Array<[PackageManager, string]>).filter(([, f]) => has(f)).map(([pm]) => pm);
  if (lockfiles.length > 1) warnings.push(`Multiple lockfiles found (${lockfiles.map((p) => LOCKFILES[p]).join(", ")}).`);

  const fromField = field?.match(/^(npm|yarn|pnpm)@/)?.[1] as PackageManager | undefined;
  if (fromField) {
    if (lockfiles.length > 0 && !lockfiles.includes(fromField)) {
      warnings.push(`package.json "packageManager" says ${fromField} but the lockfile belongs to ${lockfiles.join("/")}.`);
    }
    return { pm: fromField, reason: `package.json "packageManager": "${field}"`, warnings };
  }
  if (lockfiles.length > 0) return { pm: lockfiles[0], reason: LOCKFILES[lockfiles[0]], warnings };
  return { pm: "npm", reason: "no lockfile (defaulting to npm)", warnings };
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

type PkgJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [k: string]: unknown;
};

function readPkg(repoPath: string): PkgJson | null {
  const p = path.join(repoPath, "package.json");
  return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, "utf8")) as PkgJson) : null;
}

/** Range written for the target: "18.3.1" → "^18.3.1", "^18" stays "^18". */
export function targetRange(toVersion: string): string {
  return /^[\^~<>=]/.test(toVersion) ? toVersion : `^${toVersion}`;
}

/**
 * Compute the package.json edits for upgrading `dependency` to `toVersion`.
 * Synced packages get the same range; type packages get ^<targetMajor>;
 * curated peer companions that would block the install (`autoUpgrade`
 * conflicts from lib/compat.ts) get their known-compatible range. Only
 * packages already declared are changed — nothing is added.
 */
export function planPackageChanges(
  repoPath: string,
  dependency: string,
  toVersion: string,
  peerConflicts: PeerConflict[] = []
): PackageChange[] {
  const pkg = readPkg(repoPath);
  if (!pkg) return [];
  const eco = resolveEcosystem(dependency);
  const range = targetRange(toVersion);
  const major = parseMajor(toVersion);

  const wanted = new Map<string, { to: string; reason: NonNullable<PackageChange["reason"]> }>();
  wanted.set(dependency, { to: range, reason: "target" });
  for (const name of eco.syncedPackages) if (!wanted.has(name)) wanted.set(name, { to: range, reason: "companion" });
  if (major !== null) for (const name of eco.typePackages) wanted.set(name, { to: `^${major}`, reason: "types" });
  for (const c of peerConflicts) {
    if (c.autoUpgrade && c.suggestion && !wanted.has(c.name)) wanted.set(c.name, { to: c.suggestion, reason: "peer-compat" });
  }

  const changes: PackageChange[] = [];
  for (const section of ["dependencies", "devDependencies"] as const) {
    for (const [name, { to, reason }] of wanted) {
      const from = pkg[section]?.[name];
      if (from !== undefined && from !== to) changes.push({ name, section, from, to, reason });
    }
  }
  return changes;
}

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

/** Write the planned ranges into package.json, preserving its indentation. */
export function writePackageChanges(repoPath: string, changes: PackageChange[]): void {
  const p = path.join(repoPath, "package.json");
  const raw = fs.readFileSync(p, "utf8");
  const indent = raw.match(/^\{\s*\n([ \t]+)"/)?.[1] ?? "  ";
  const pkg = JSON.parse(raw) as PkgJson;
  for (const c of changes) {
    const section = (pkg[c.section] ??= {});
    section[c.name] = c.to;
  }
  fs.writeFileSync(p, JSON.stringify(pkg, null, indent) + (raw.endsWith("\n") ? "\n" : ""), "utf8");
}

export interface InstallResult {
  ok: boolean;
  command: string;
  lockfile: string | null;
  output: string;
}

/**
 * Run the package manager's install so node_modules and the lockfile reflect
 * the edited package.json.
 *
 * - npm: no lockfile in the repo -> `--no-package-lock` (the PR must not
 *   suddenly add one); audit/fund noise is disabled.
 * - pnpm: `--no-frozen-lockfile`, because CI=true (set so test runners stay
 *   out of watch mode) would otherwise make pnpm refuse to update the lockfile.
 * - yarn 2+: YARN_ENABLE_IMMUTABLE_INSTALLS=false for the same reason
 *   (ignored by yarn 1).
 */
export function runInstall(repoPath: string, pm: PackageManager): InstallResult {
  const lockfile = fs.existsSync(path.join(repoPath, LOCKFILES[pm])) ? LOCKFILES[pm] : null;
  const args = ["install"];
  let env: NodeJS.ProcessEnv | undefined;
  if (pm === "npm") {
    args.push("--no-audit", "--no-fund");
    if (!lockfile) args.push("--no-package-lock");
  } else if (pm === "pnpm") {
    args.push("--no-frozen-lockfile");
  } else {
    env = { YARN_ENABLE_IMMUTABLE_INSTALLS: "false" };
  }
  const result = runner(pm, args, repoPath, env);
  return { ok: result.ok, command: [pm, ...args].join(" "), lockfile, output: result.output };
}

/**
 * Explain an install failure in one actionable sentence: missing package
 * manager binary, peer-dependency conflict (naming the packages), or network.
 */
export function diagnoseInstallFailure(output: string, pm: PackageManager, dependency: string, toVersion: string): string {
  if (/ENOENT|is not recognized as an internal or external command|command not found/i.test(output) && output.length < 600) {
    return `\`${pm}\` does not appear to be installed on this machine (install it, e.g. \`corepack enable\` for yarn/pnpm, and retry).`;
  }
  if (/ERESOLVE|peer dep|unmet peer|Conflicting peer dependency|ERR_PNPM_PEER_DEP_ISSUES/i.test(output)) {
    const blockers = [...output.matchAll(/peer (\S+@"[^"]+") from (\S+)/gi)]
      .map((m) => `${m[2]} (needs ${m[1]})`)
      .filter((v, i, a) => a.indexOf(v) === i)
      .slice(0, 4);
    return (
      `Peer-dependency conflict: ${blockers.length > 0 ? blockers.join("; ") : `a dependency's peer range excludes ${dependency} ${toVersion}`}. ` +
      `Upgrade the blocking package on the migration branch (see the plan's peer-compatibility step), commit, and retry this step.`
    );
  }
  if (/ETARGET|No matching version found|ERR_PNPM_NO_MATCHING_VERSION|Couldn't find any versions/i.test(output)) {
    const which = output.match(/No matching version found for (\S+)/)?.[1];
    return `No published version matches ${which ?? `${dependency} ${toVersion}`} — check the target version (e.g. \`npm view ${dependency} versions\`) and start a new session with a version that exists.`;
  }
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|network/i.test(output)) {
    return "The package registry could not be reached — check the network connection and retry.";
  }
  return `\`${pm} install\` failed — see the output above.`;
}

/** Read exact installed versions from node_modules (null = not installed). */
export function readInstalledVersions(repoPath: string, names: string[]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const name of names) {
    const p = path.join(repoPath, "node_modules", name, "package.json");
    out[name] = fs.existsSync(p) ? ((JSON.parse(fs.readFileSync(p, "utf8")) as { version?: string }).version ?? null) : null;
  }
  return out;
}

export interface InstalledCheck {
  ok: boolean;
  installed: Record<string, string | null>;
  problems: string[];
}

/**
 * Verify node_modules holds the upgraded family: every declared synced package
 * is installed, satisfies the target range, and all synced packages share one
 * exact version (react and react-dom must match).
 */
export function checkInstalledVersions(repoPath: string, dependency: string, toVersion: string): InstalledCheck {
  const eco = resolveEcosystem(dependency);
  const pkg = readPkg(repoPath) ?? {};
  const declared = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
  const names = [...new Set([dependency, ...eco.syncedPackages])].filter((n) => declared.has(n));
  const installed = readInstalledVersions(repoPath, names);
  const problems: string[] = [];

  for (const name of names) {
    const v = installed[name];
    if (!v) problems.push(`${name} is not installed (node_modules/${name} missing)`);
    else if (!satisfiesCaret(v, toVersion)) problems.push(`${name}@${v} does not satisfy ${targetRange(toVersion)}`);
  }
  const versions = new Set(names.map((n) => installed[n]).filter(Boolean));
  if (versions.size > 1) {
    problems.push(`companion versions differ: ${names.map((n) => `${n}@${installed[n]}`).join(", ")}`);
  }
  return { ok: problems.length === 0, installed, problems };
}
