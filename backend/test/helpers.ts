/**
 * Test helpers: disposable git working copies of the fixture app, sessions
 * seeded without GitHub/network, and a fake package-manager runner.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { findDependencyUsages } from "../src/lib/ast.js";
import { resolveEcosystem } from "../src/lib/ecosystem.js";
import { createSession, writeAnalysis } from "../src/lib/session.js";
import type { CommandRunner } from "../src/lib/packages.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE_SRC = path.resolve(__dirname, "fixtures/react17-app");

export function sh(cwd: string, cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
}

export function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

/** Copy the fixture to a temp dir and make it a git repo with one commit. */
export function prepareWorkingCopy(mutate?: (dir: string) => void): string {
  const dest = path.join(os.tmpdir(), `codebase-doctor-test-${randomUUID()}`);
  copyDirRecursive(FIXTURE_SRC, dest);
  mutate?.(dest);
  sh(dest, "git", ["init", "-q", "-b", "main"]);
  sh(dest, "git", ["config", "user.email", "test@example.com"]);
  sh(dest, "git", ["config", "user.name", "Test"]);
  sh(dest, "git", ["add", "-A"]);
  sh(dest, "git", ["commit", "-q", "-m", "initial fixture"]);
  return dest;
}

/** Create a session + analysis for a working copy, exactly as analyze_dependency_usage would. */
export function seedSession(workingCopy: string, opts: { toVersion?: string; branch?: string } = {}): string {
  const usages = findDependencyUsages({ repoPath: workingCopy, dependency: resolveEcosystem("react").packages });
  const session = createSession({
    repo: {
      url: "https://github.com/test/react17-fixture",
      owner: "test",
      name: "react17-fixture",
      localPath: workingCopy,
      defaultBranch: "main",
    },
    upgrade: { dependency: "react", fromVersion: "^17.0.2", toVersion: opts.toVersion ?? "18.3.1" },
    migrationBranch: opts.branch ?? "codebase-doctor/react-18.3.1-upgrade",
  });
  writeAnalysis(session.id, {
    repoLanguage: "javascript",
    packageManager: "npm",
    testFramework: "jest",
    buildCommand: "npm run build",
    lintCommand: "npm run lint",
    testCommand: "npm run test",
    dependencyUsages: usages,
    blastRadius: null,
  });
  return session.id;
}

export interface FakeInstallOptions {
  /** Versions written to node_modules/<name>/package.json. */
  versions?: Record<string, string>;
  fail?: boolean;
}

/**
 * A fake `npm install`: records calls, writes node_modules package.json files,
 * and rewrites package-lock.json root deps from package.json (like npm would).
 */
export function fakeInstaller(opts: FakeInstallOptions = {}) {
  const calls: Array<{ cmd: string; args: string[]; cwd: string }> = [];
  const runner: CommandRunner = (cmd, args, cwd) => {
    calls.push({ cmd, args, cwd });
    if (opts.fail) return { ok: false, output: "npm ERR! code ERESOLVE\nnpm ERR! peer react@\"<18\" from @testing-library/react@12.1.5" };
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const versions = opts.versions ?? { react: "18.3.1", "react-dom": "18.3.1" };
    for (const [name, version] of Object.entries(versions)) {
      const dir = path.join(cwd, "node_modules", name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, version }));
    }
    const lockPath = path.join(cwd, "package-lock.json");
    if (fs.existsSync(lockPath) && !args.includes("--no-package-lock")) {
      const lock = JSON.parse(fs.readFileSync(lockPath, "utf8")) as {
        packages: Record<string, { version?: string; dependencies?: Record<string, string> }>;
      };
      lock.packages[""].dependencies = pkg.dependencies;
      for (const [name, version] of Object.entries(versions)) lock.packages[`node_modules/${name}`] = { version };
      fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");
    }
    return { ok: true, output: "added 2 packages" };
  };
  return { runner, calls };
}

export function removeDir(dir: string | undefined): void {
  if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}
