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

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolveEcosystem, parseMajor, satisfiesCaret } from "./ecosystem.js";
import type { PackageChange } from "../types.js";

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
export type CommandRunner = (cmd: string, args: string[], cwd: string) => CommandResult;

const defaultRunner: CommandRunner = (cmd, args, cwd) => {
  try {
    const out = execFileSync(cmd, args, {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10 * 60_000,
      env: { ...process.env, CI: "true" },
    });
    return { ok: true, output: out };
  } catch (err) {
    const e = err as { stdout?: unknown; stderr?: unknown; message?: string };
    return { ok: false, output: `${String(e.stdout ?? "")}${String(e.stderr ?? "")}` || String(e.message) };
  }
};

let runner: CommandRunner = defaultRunner;

/** Override how install commands run (tests). Pass null to restore the default. */
export function setCommandRunner(r: CommandRunner | null): void {
  runner = r ?? defaultRunner;
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
 * Synced packages get the same range; type packages get ^<targetMajor>.
 */
export function planPackageChanges(repoPath: string, dependency: string, toVersion: string): PackageChange[] {
  const pkg = readPkg(repoPath);
  if (!pkg) return [];
  const eco = resolveEcosystem(dependency);
  const range = targetRange(toVersion);
  const major = parseMajor(toVersion);

  const wanted = new Map<string, string>();
  for (const name of new Set([dependency, ...eco.syncedPackages])) wanted.set(name, range);
  if (major !== null) for (const name of eco.typePackages) wanted.set(name, `^${major}`);

  const changes: PackageChange[] = [];
  for (const section of ["dependencies", "devDependencies"] as const) {
    for (const [name, to] of wanted) {
      const from = pkg[section]?.[name];
      if (from !== undefined && from !== to) changes.push({ name, section, from, to });
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
 * package.json. If the repo has no lockfile, npm is told not to create one
 * (the PR should not suddenly add a lockfile).
 */
export function runInstall(repoPath: string, pm: PackageManager): InstallResult {
  const lockfile = fs.existsSync(path.join(repoPath, LOCKFILES[pm])) ? LOCKFILES[pm] : null;
  const args = ["install"];
  if (pm === "npm" && !lockfile) args.push("--no-package-lock");
  const result = runner(pm, args, repoPath);
  return { ok: result.ok, command: [pm, ...args].join(" "), lockfile, output: result.output };
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
