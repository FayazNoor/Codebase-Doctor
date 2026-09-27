/**
 * Tool: analyze_dependency_usage
 *
 * Clones the repository (GitHub URL, or an absolute path to a local git
 * repository — which is cloned, never modified), detects tooling, runs AST
 * analysis to find the import sites and concrete API usages of the target
 * dependency's package family (for React: react, react-dom, react-dom/client,
 * react-dom/test-utils, react-dom/server), and checks declared packages for
 * peer ranges that exclude the target version.
 *
 * Creates and persists a NEW session on every call. If anything fails before
 * the analysis is written, the half-created session and clone are removed.
 */

import path from "node:path";
import fs from "node:fs";
import { cloneRepo, clonePath, detectDefaultBranch, originUrl, git } from "../lib/git.js";
import { scanDependencyUsages, listSourceFiles } from "../lib/ast.js";
import { resolveEcosystem, parseMajor, parseVersion } from "../lib/ecosystem.js";
import { getRepoInfo, GitHubApiError } from "../lib/github.js";
import { detectPackageManager } from "../lib/packages.js";
import { checkPeerCompatibility, checkTargetExists } from "../lib/compat.js";
import { parseRepoSource, parseGitHubRef, validatePackageName, normaliseTargetVersion, migrationBranchName } from "../lib/validation.js";
import { createSession, writeAnalysis, updateSession, deleteSessionDir } from "../lib/session.js";
import type { AnalysisResult } from "../types.js";

interface Input {
  url: string;
  dependency: string;
  targetVersion: string;
}

type PkgJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};

export async function analyzeDependencyUsage(input: Input): Promise<string> {
  const dependency = validatePackageName(input.dependency);
  const targetVersion = normaliseTargetVersion(input.targetVersion);
  const source = parseRepoSource(input.url);
  const token = process.env["GITHUB_TOKEN"] || undefined;
  const warnings: string[] = [];

  // --- Identity, default branch and clone source -----------------------------
  let owner: string;
  let name: string;
  let defaultBranch: string | null = null;
  let cloneFrom: string;
  let origin: string | undefined;

  if (source.kind === "github") {
    ({ owner, repo: name } = source);
    cloneFrom = source.cloneUrl;
    origin = source.cloneUrl;
    try {
      const meta = await getRepoInfo(owner, name);
      defaultBranch = meta.defaultBranch;
      if (meta.archived) warnings.push("Repository is archived on GitHub — a pull request cannot be opened.");
    } catch (err) {
      // Not found / bad credentials are fatal; rate limits and network hiccups are not (the clone may still work).
      if (err instanceof GitHubApiError && (err.status === 404 || err.status === 401)) throw err;
      warnings.push(`GitHub metadata unavailable (${(err as Error).message}); default branch taken from the clone.`);
    }
  } else {
    const remote = originUrl(source.path);
    let gh: ReturnType<typeof parseGitHubRef> = null;
    try {
      gh = remote ? parseGitHubRef(remote) : null;
    } catch {
      gh = null;
    }
    owner = gh?.owner ?? "";
    name = gh?.repo ?? path.basename(source.path);
    cloneFrom = source.path;
    origin = gh?.cloneUrl;
    if (gh) {
      try {
        defaultBranch = (await getRepoInfo(gh.owner, gh.repo)).defaultBranch;
      } catch {
        defaultBranch = null;
      }
    } else {
      warnings.push("Local repository without a GitHub remote — every step works, but create_pull_request is unavailable.");
    }
    const dirty = git(["status", "--porcelain", "--untracked-files=no"], source.path);
    if (dirty) warnings.push("The local repository has uncommitted changes; only committed code (HEAD) is analysed and migrated.");
  }

  // --- Session + clone (rolled back if anything below fails) -----------------
  const session = createSession({
    repo: { url: input.url.trim(), source: source.kind, owner, name, localPath: "", defaultBranch: defaultBranch ?? "" },
    upgrade: { dependency, fromVersion: "unknown", toVersion: targetVersion },
    migrationBranch: migrationBranchName(dependency, targetVersion),
  });

  try {
    const localPath = cloneRepo({ cloneFrom, originUrl: origin }, owner, name, session.id, source.kind === "github" ? token : undefined);
    if (!defaultBranch) defaultBranch = detectDefaultBranch(localPath);

    // --- Project checks ---------------------------------------------------------
    const pkgJsonPath = path.join(localPath, "package.json");
    if (!fs.existsSync(pkgJsonPath)) {
      throw new Error(
        "No package.json at the repository root — Codebase Doctor supports Node.js projects with a root package.json " +
          "(monorepos with the app in a sub-folder are not supported yet)."
      );
    }
    let pkgJson: PkgJson;
    try {
      pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as PkgJson;
    } catch {
      throw new Error("package.json at the repository root is not valid JSON.");
    }
    const fromVersion = pkgJson.dependencies?.[dependency] ?? pkgJson.devDependencies?.[dependency] ?? null;
    if (!fromVersion) {
      const peer = pkgJson.peerDependencies?.[dependency];
      throw new Error(
        `'${dependency}' is not declared in package.json dependencies or devDependencies` +
          (peer ? ` (it is only a peerDependency: ${peer} — library peer ranges are not upgraded by this tool).` : ".")
      );
    }
    const fromMajor = parseMajor(fromVersion);
    const toMajor = parseMajor(targetVersion);
    if (fromMajor !== null && toMajor !== null && toMajor < fromMajor) {
      throw new Error(`Downgrades are not supported: ${dependency} is ${fromVersion}, target is ${targetVersion}.`);
    }
    if (fromMajor !== null && fromMajor === toMajor) {
      const f = parseVersion(fromVersion);
      const t = parseVersion(targetVersion);
      warnings.push(
        f && t && f[1] !== null && t[1] !== null && f[1] >= t[1]
          ? `${dependency} ${fromVersion} already satisfies major ${toMajor}; there may be nothing to migrate.`
          : `Minor upgrade within ${dependency} ${toMajor}.x — major-version migration rules do not apply.`
      );
    }

    // Fail fast on a target that was never published (npm would otherwise report it
    // as a confusing peer-dependency conflict much later, during the install).
    const target = await checkTargetExists(dependency, targetVersion);
    if (target.checked && !target.exists) {
      throw new Error(
        `No published version of ${dependency} matches ${targetVersion}` +
          (target.newestInMajor ? ` (newest in that major: ${target.newestInMajor})` : target.newest ? ` (newest published: ${target.newest})` : "") +
          `. Check the version (e.g. \`npm view ${dependency} versions\`) and try again.`
      );
    }
    if (!target.checked) warnings.push(`Could not confirm on the npm registry that ${dependency} ${targetVersion} exists (offline or unreachable).`);

    const pmInfo = detectPackageManager(localPath);
    warnings.push(...pmInfo.warnings);
    const pm = pmInfo.pm;

    const scripts = pkgJson.scripts ?? {};
    const script = (name: string) => (scripts[name] && !/no test specified/i.test(scripts[name]) ? `${pm} run ${name}` : null);
    if (scripts["test"] && /no test specified/i.test(scripts["test"])) {
      warnings.push("The test script is npm's placeholder (\"no test specified\"); tests are treated as absent.");
    }

    // --- Source scan (one walk) -------------------------------------------------
    const allFiles = listSourceFiles(localPath);
    const tsFiles = allFiles.filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".d.ts")).length;
    const jsFiles = allFiles.length - tsFiles;
    const repoLanguage: AnalysisResult["repoLanguage"] =
      tsFiles > 0 && jsFiles > 0 ? "mixed" : tsFiles > 0 || fs.existsSync(path.join(localPath, "tsconfig.json")) ? "typescript" : "javascript";

    const ecosystem = resolveEcosystem(dependency);
    const { usages, stats } = scanDependencyUsages({ repoPath: localPath, dependency: ecosystem.packages });
    if (stats.filesTooLarge > 0) warnings.push(`${stats.filesTooLarge} file(s) over 1 MB were skipped (likely generated bundles).`);

    const compat = await checkPeerCompatibility({ repoPath: localPath, ecosystem, toVersion: targetVersion });

    const analysis: AnalysisResult = {
      repoLanguage,
      packageManager: pm,
      testFramework: detectTestFramework(pkgJson),
      buildCommand: script("build"),
      lintCommand: script("lint"),
      testCommand: script("test"),
      dependencyUsages: usages,
      blastRadius: null,
      filesScanned: stats.filesScanned,
      compat,
      warnings,
    };

    writeAnalysis(session.id, analysis);
    updateSession(session.id, {
      repo: { ...session.repo, localPath, defaultBranch: defaultBranch ?? "main" },
      upgrade: { ...session.upgrade, fromVersion },
    });

    // --- Compact summary for Bob ------------------------------------------------
    const fileCount = new Set(usages.map((u) => u.file)).size;
    const imports = usages.filter((u) => u.kind === "import").length;
    const apiUses = usages.length - imports;
    const conflicts = compat.conflicts;
    const repoLabel = owner ? `${owner}/${name}` : `${name} (local)`;
    return [
      `✅ Session created: ${session.id}`,
      `📦 ${dependency} ${fromVersion} → ${targetVersion} · branch ${session.migrationBranch}`,
      `📁 ${repoLabel} @ ${defaultBranch} (${repoLanguage}, ${pm} — ${pmInfo.reason})`,
      `🔍 ${stats.filesScanned} source files scanned; ${ecosystem.packages.join(" + ")} used in ${fileCount} files ` +
        `(${imports} imports, ${apiUses} API usages)`,
      `🧪 Tests: ${analysis.testCommand ?? "none"}${analysis.testFramework ? ` (${analysis.testFramework})` : ""} · build: ${analysis.buildCommand ?? "none"} · lint: ${analysis.lintCommand ?? "none"}`,
      compat.checked
        ? conflicts.length > 0
          ? `🧩 Peer conflicts: ${conflicts.map((c) => `${c.name}@${c.version} (peer ${c.peer} ${c.range.split(" — ")[0]})`).slice(0, 4).join("; ")}`
          : `🧩 Peer compatibility: no conflicts (${compat.method})`
        : `🧩 Peer compatibility: not checked${compat.note ? ` — ${compat.note}` : ""}`,
      ...warnings.map((w) => `⚠️ ${w}`),
      ``,
      `Next step: call load_migration_requirements with sessionId ${session.id}`,
    ].join("\n");
  } catch (err) {
    // Leave no half-created session or clone behind.
    deleteSessionDir(session.id);
    fs.rmSync(clonePath(owner, name, session.id), { recursive: true, force: true });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function detectTestFramework(pkg: PkgJson): string | null {
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (allDeps["vitest"]) return "vitest";
  if (allDeps["jest"]) return "jest";
  if (allDeps["react-scripts"]) return "jest (react-scripts)";
  if (allDeps["mocha"]) return "mocha";
  if (allDeps["jasmine"]) return "jasmine";
  return null;
}
