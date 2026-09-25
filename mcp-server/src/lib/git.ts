/**
 * Git helpers — clone, branch, commit, push.
 * All operations are scoped to a local path; never touch the user's working tree.
 */

import { execSync, type ExecSyncOptionsWithStringEncoding } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const CLONE_BASE = path.join(os.homedir(), ".codebase-doctor", "repos");

const EXEC_OPTS: ExecSyncOptionsWithStringEncoding = {
  encoding: "utf8",
  stdio: ["pipe", "pipe", "pipe"],
};

function run(cmd: string, cwd?: string): string {
  return execSync(cmd, { ...EXEC_OPTS, cwd }).trim();
}

// ---------------------------------------------------------------------------
// Clone
// ---------------------------------------------------------------------------

/**
 * Clone a repository into ~/.codebase-doctor/repos/<owner>/<repo>/<sessionId>.
 * If the directory already exists (session restart), skip cloning.
 * Returns the absolute local path.
 */
export function cloneRepo(
  url: string,
  owner: string,
  repoName: string,
  sessionId: string,
  token?: string
): string {
  const localPath = path.join(CLONE_BASE, owner, repoName, sessionId);

  if (fs.existsSync(path.join(localPath, ".git"))) {
    return localPath; // already cloned — idempotent
  }

  fs.mkdirSync(localPath, { recursive: true });

  const cloneUrl =
    token
      ? url.replace("https://", `https://x-access-token:${token}@`)
      : url;

  run(`git clone --depth=1 "${cloneUrl}" .`, localPath);
  return localPath;
}

// ---------------------------------------------------------------------------
// Branch
// ---------------------------------------------------------------------------

/**
 * Create and check out a new branch. Idempotent: if the branch already
 * exists, switch to it without error.
 */
export function checkoutNewBranch(localPath: string, branchName: string): void {
  try {
    run(`git checkout -b "${branchName}"`, localPath);
  } catch {
    // Branch may already exist (session restart)
    run(`git checkout "${branchName}"`, localPath);
  }
}

export function currentBranch(localPath: string): string {
  return run("git rev-parse --abbrev-ref HEAD", localPath);
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

export function stageAll(localPath: string): void {
  run("git add -A", localPath);
}

export function commit(localPath: string, message: string): void {
  run(`git commit -m "${message.replace(/"/g, '\\"')}"`, localPath);
}

export function stageAndCommit(localPath: string, message: string): void {
  stageAll(localPath);
  try {
    commit(localPath, message);
  } catch {
    // Nothing staged (no changes) — not an error
  }
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

/**
 * Return a compact stat diff (files changed + insertions/deletions).
 * Use for MCP tool output summaries — not the full patch.
 */
export function diffStat(localPath: string, base?: string): string {
  const ref = base ?? "HEAD~1";
  try {
    return run(`git diff --stat "${ref}"`, localPath);
  } catch {
    return "(no previous commit to diff against)";
  }
}

export function diffFull(localPath: string, base?: string): string {
  const ref = base ?? "HEAD~1";
  try {
    return run(`git diff "${ref}"`, localPath);
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

export function pushBranch(
  localPath: string,
  branchName: string,
  token?: string
): void {
  if (token) {
    // Inject token into remote URL for push
    const remoteUrl = run("git remote get-url origin", localPath);
    const authedUrl = remoteUrl.replace("https://", `https://x-access-token:${token}@`);
    run(`git remote set-url origin "${authedUrl}"`, localPath);
  }
  run(`git push -u origin "${branchName}"`, localPath);
}

// ---------------------------------------------------------------------------
// Repository introspection
// ---------------------------------------------------------------------------

export function detectDefaultBranch(localPath: string): string {
  try {
    return run(
      "git symbolic-ref refs/remotes/origin/HEAD --short",
      localPath
    ).replace("origin/", "");
  } catch {
    // Fallback: check for 'main' or 'master'
    const branches = run("git branch -r", localPath);
    if (branches.includes("origin/main")) return "main";
    return "master";
  }
}
