/**
 * Git helpers — clone, branch, commit, push.
 * All operations are scoped to a local path; never touch the user's working tree.
 *
 * Commands run via execFileSync with an argument array (no shell), so commit
 * messages and branch names derived from docs text cannot inject shell code.
 * A GitHub token is only ever passed on the command line for the single clone
 * / push that needs it — it is never stored in .git/config — and it is redacted
 * from every error message.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { doctorHome } from "./session.js";

export class GitError extends Error {
  constructor(
    message: string,
    readonly args: string[],
    readonly stderr: string
  ) {
    super(message);
    this.name = "GitError";
  }
}

function redact(text: string): string {
  return text.replace(/x-access-token:[^@\s]+@/g, "x-access-token:***@");
}

/** Run git with an argument array. Throws GitError with stderr on failure. */
export function git(args: string[], cwd: string): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    const e = err as { stderr?: unknown; stdout?: unknown; message?: string };
    const stderr = redact(String(e.stderr ?? "") + String(e.stdout ?? "")).trim();
    const shown = redact(args.join(" "));
    throw new GitError(`git ${shown} failed: ${stderr || redact(e.message ?? "unknown error")}`, args, stderr);
  }
}

/** Run git and return exit status (0 = success) without throwing. */
function gitStatusCode(args: string[], cwd: string): number {
  try {
    execFileSync("git", args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    return 0;
  } catch (err) {
    const status = (err as { status?: number }).status;
    return typeof status === "number" ? status : 1;
  }
}

function authedUrl(url: string, token?: string): string {
  return token ? url.replace("https://", `https://x-access-token:${token}@`) : url;
}

// ---------------------------------------------------------------------------
// Clone
// ---------------------------------------------------------------------------

/**
 * Clone a repository into <home>/repos/<owner>/<repo>/<sessionId>.
 * If the directory already contains a clone (session restart), skip cloning.
 * Returns the absolute local path.
 */
export function cloneRepo(
  url: string,
  owner: string,
  repoName: string,
  sessionId: string,
  token?: string
): string {
  const localPath = path.join(doctorHome(), "repos", owner, repoName, sessionId);

  if (fs.existsSync(path.join(localPath, ".git"))) {
    return localPath; // already cloned — idempotent
  }

  fs.mkdirSync(localPath, { recursive: true });
  git(["clone", "--depth=1", authedUrl(url, token), "."], localPath);
  // Never leave the token in .git/config.
  git(["remote", "set-url", "origin", url], localPath);
  return localPath;
}

// ---------------------------------------------------------------------------
// Branch
// ---------------------------------------------------------------------------

export function branchExists(localPath: string, branchName: string): boolean {
  return gitStatusCode(["rev-parse", "--verify", "--quiet", `refs/heads/${branchName}`], localPath) === 0;
}

/**
 * Create and check out a branch, or switch to it if it already exists
 * (session restart). Any other failure (dirty tree, invalid name, not a repo)
 * propagates. Returns true if the branch was newly created.
 */
export function checkoutNewBranch(localPath: string, branchName: string): boolean {
  if (branchExists(localPath, branchName)) {
    if (currentBranch(localPath) !== branchName) git(["checkout", branchName], localPath);
    return false;
  }
  git(["checkout", "-b", branchName], localPath);
  return true;
}

export function currentBranch(localPath: string): string {
  return git(["rev-parse", "--abbrev-ref", "HEAD"], localPath);
}

export function headCommit(localPath: string): string | null {
  try {
    return git(["rev-parse", "HEAD"], localPath);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

/** Directories never staged by the tool (build output, installed packages). */
const ARTIFACT_DIRS = ["node_modules", "dist", "build", "coverage", ".next", "out"];

/**
 * Stage changes. With `paths`, stage exactly those (existing or deleted)
 * files; without, stage everything except common build/install artifacts.
 */
export function stage(localPath: string, paths?: string[]): void {
  if (paths) {
    const tracked = paths.filter(
      (p) => fs.existsSync(path.join(localPath, p)) || gitStatusCode(["ls-files", "--error-unmatch", p], localPath) === 0
    );
    if (tracked.length > 0) git(["add", "-A", "--", ...tracked], localPath);
    return;
  }
  // Exclude artifact dirs that exist and are NOT already gitignored (naming an
  // ignored path in a pathspec makes `git add` fail).
  const excludes = ARTIFACT_DIRS.filter(
    (d) => fs.existsSync(path.join(localPath, d)) && gitStatusCode(["check-ignore", "-q", d], localPath) !== 0
  ).map((d) => `:(exclude)${d}`);
  git(["add", "-A", "--", ".", ...excludes], localPath);
}

/** True when the index has staged changes relative to HEAD. */
export function hasStagedChanges(localPath: string): boolean {
  // `git diff --cached --quiet` exits 1 when there are staged changes,
  // 0 when there are none, and >1 on a real error.
  const code = gitStatusCode(["diff", "--cached", "--quiet"], localPath);
  if (code === 0) return false;
  if (code === 1) return true;
  // Surface the real problem (e.g. not a git repository).
  git(["diff", "--cached", "--quiet"], localPath);
  return true;
}

export interface CommitResult {
  committed: boolean;
  sha: string | null;
  files: string[];
}

/**
 * Stage and commit. Returns { committed: false } ONLY when there is genuinely
 * nothing to commit; identity, hook, permission and repository errors are
 * thrown with git's own message plus a suggested fix.
 */
export function stageAndCommit(localPath: string, message: string, paths?: string[]): CommitResult {
  stage(localPath, paths);
  if (!hasStagedChanges(localPath)) {
    return { committed: false, sha: null, files: [] };
  }
  const files = git(["diff", "--cached", "--name-only"], localPath).split("\n").filter(Boolean);
  try {
    git(["commit", "-m", message], localPath);
  } catch (err) {
    const stderr = err instanceof GitError ? err.stderr : String(err);
    let hint = "";
    if (/tell me who you are|user\.email|user\.name/i.test(stderr)) {
      hint = " Fix: set git identity, e.g. `git config --global user.name \"Your Name\"` and `git config --global user.email you@example.com`.";
    } else {
      hint = " (If the repository has pre-commit/commit-msg hooks, e.g. husky/lint-staged, they may have rejected the commit — resolve their output above and re-run the step.)";
    }
    throw new Error(`${err instanceof Error ? err.message : String(err)}${hint}`);
  }
  return { committed: true, sha: git(["rev-parse", "HEAD"], localPath), files };
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

/** Compact stat for a single commit (for MCP tool summaries). */
export function commitStat(localPath: string, sha: string): string {
  return git(["show", "--stat", "--format=", sha], localPath);
}

/** Files changed between two commits (e.g. migration base → HEAD). */
export function changedFiles(localPath: string, base: string, head = "HEAD"): string[] {
  return git(["diff", "--name-only", base, head], localPath).split("\n").filter(Boolean);
}

/** Restore paths to their HEAD state (used to roll back a failed step). */
export function restorePaths(localPath: string, paths: string[]): void {
  const tracked = paths.filter((p) => gitStatusCode(["ls-files", "--error-unmatch", p], localPath) === 0);
  if (tracked.length > 0) git(["checkout", "HEAD", "--", ...tracked], localPath);
}

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

/**
 * Push the branch. The token-bearing URL is used for this one command only;
 * the stored `origin` remote stays tokenless.
 */
export function pushBranch(localPath: string, branchName: string, token?: string): void {
  const remoteUrl = git(["remote", "get-url", "origin"], localPath);
  const target = token ? authedUrl(remoteUrl, token) : "origin";
  git(["push", target, `HEAD:refs/heads/${branchName}`], localPath);
}

// ---------------------------------------------------------------------------
// Repository introspection
// ---------------------------------------------------------------------------

export function detectDefaultBranch(localPath: string): string {
  try {
    return git(["symbolic-ref", "refs/remotes/origin/HEAD", "--short"], localPath).replace("origin/", "");
  } catch {
    const branches = git(["branch", "-r"], localPath);
    if (branches.includes("origin/main")) return "main";
    return "master";
  }
}
