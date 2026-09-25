/**
 * Tool: analyze_dependency_usage
 *
 * Clones the repository, detects tooling, and runs AST analysis to find
 * every usage of the target dependency. Creates and persists the session.
 */

import path from "node:path";
import fs from "node:fs";
import { cloneRepo, detectDefaultBranch } from "../lib/git.js";
import { findDependencyUsages } from "../lib/ast.js";
import { parseGitHubUrl, getRepoInfo } from "../lib/github.js";
import { createSession, writeAnalysis, sessionDir } from "../lib/session.js";
import type { AnalysisResult } from "../types.js";

interface Input {
  url: string;
  dependency: string;
  targetVersion: string;
}

export async function analyzeDependencyUsage(input: Input): Promise<string> {
  const { url, dependency, targetVersion } = input;

  const { owner, repo } = parseGitHubUrl(url);

  // Fetch repo metadata (default branch)
  const repoInfo = await getRepoInfo(owner, repo);

  // Create session (generates sessionId)
  const session = createSession({
    repo: {
      url,
      owner,
      name: repo,
      localPath: "", // filled in after clone
      defaultBranch: repoInfo.defaultBranch,
    },
    upgrade: {
      dependency,
      fromVersion: "unknown", // detected below
      toVersion: targetVersion,
    },
    migrationBranch: `codebase-doctor/${dependency}-${targetVersion}-upgrade`,
  });

  // Clone
  const token = process.env["GITHUB_TOKEN"];
  const localPath = cloneRepo(url, owner, repo, session.id, token);

  // Detect current installed version from package.json
  const pkgJsonPath = path.join(localPath, "package.json");
  let fromVersion = "unknown";
  if (fs.existsSync(pkgJsonPath)) {
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    fromVersion =
      pkgJson.dependencies?.[dependency] ??
      pkgJson.devDependencies?.[dependency] ??
      "unknown";
  }

  // Detect package manager
  const packageManager =
    fs.existsSync(path.join(localPath, "yarn.lock")) ? "yarn" :
    fs.existsSync(path.join(localPath, "pnpm-lock.yaml")) ? "pnpm" : "npm";

  // Detect language
  const hasTsConfig = fs.existsSync(path.join(localPath, "tsconfig.json"));
  const hasTsFiles = findFilesByExt(localPath, ".ts").length > 0;
  const repoLanguage =
    hasTsConfig || hasTsFiles ? "typescript" :
    findFilesByExt(localPath, ".tsx").length > 0 ? "typescript" : "javascript";

  // Detect test framework, build/lint commands from package.json scripts
  const scripts: Record<string, string> = fs.existsSync(pkgJsonPath)
    ? (JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as { scripts?: Record<string, string> }).scripts ?? {}
    : {};

  const testFramework = detectTestFramework(localPath);
  const testCommand = scripts["test"] ? `${packageManager} run test` : null;
  const buildCommand = scripts["build"] ? `${packageManager} run build` : null;
  const lintCommand = scripts["lint"] ? `${packageManager} run lint` : null;

  // AST analysis
  const usages = findDependencyUsages({ repoPath: localPath, dependency });

  const analysis: AnalysisResult = {
    repoLanguage,
    packageManager,
    testFramework,
    buildCommand,
    lintCommand,
    testCommand,
    dependencyUsages: usages,
    blastRadius: null,
  };

  // Persist
  writeAnalysis(session.id, analysis);
  // Update session with resolved values
  const { updateSession } = await import("../lib/session.js");
  updateSession(session.id, {
    repo: { ...session.repo, localPath },
    upgrade: { ...session.upgrade, fromVersion },
  });

  // Compact summary for Bob context
  const fileCount = new Set(usages.map((u) => u.file)).size;
  return [
    `✅ Session created: ${session.id}`,
    `📦 ${dependency} ${fromVersion} → ${targetVersion}`,
    `📁 Repository: ${owner}/${repo} (${repoLanguage}, ${packageManager})`,
    `🔍 Found ${usages.length} import sites across ${fileCount} files`,
    `🧪 Test framework: ${testFramework ?? "not detected"}`,
    `⚙️  Commands — build: ${buildCommand ?? "none"}, test: ${testCommand ?? "none"}, lint: ${lintCommand ?? "none"}`,
    ``,
    `Session ID: ${session.id}`,
    `Next step: call load_migration_requirements with this sessionId`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function findFilesByExt(dir: string, ext: string): string[] {
  const results: string[] = [];
  const walk = (current: string) => {
    try {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (["node_modules", ".git", "dist", "build"].includes(entry.name)) continue;
          walk(path.join(current, entry.name));
        } else if (entry.name.endsWith(ext)) {
          results.push(path.join(current, entry.name));
        }
      }
    } catch {
      // Skip unreadable dirs
    }
  };
  walk(dir);
  return results;
}

function detectTestFramework(repoPath: string): string | null {
  const pkgPath = path.join(repoPath, "package.json");
  if (!fs.existsSync(pkgPath)) return null;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (allDeps["vitest"]) return "vitest";
  if (allDeps["jest"]) return "jest";
  if (allDeps["mocha"]) return "mocha";
  if (allDeps["jasmine"]) return "jasmine";
  return null;
}
