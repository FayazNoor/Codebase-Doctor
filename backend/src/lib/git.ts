/**
 * Git helpers — clone, branch, commit, push.
 * All operations are scoped to a session-owned clone; the user's own working
 * tree is never touched (a local repository is cloned, not modified).
 *
 * Commands run via execFileSync with an argument array (no shell), so commit
 * messages and branch names derived from docs text cannot inject shell code.
 *
 * Credentials: a GitHub token is never put on the command line or into
 * .git/config. It is passed for the single clone / push that needs it as an
 * `http.<origin>/.extraheader` entry through git's GIT_CONFIG_* environment
 * variables, and it is redacted from every error message. Interactive
 * credential prompts are disabled so a private repository without a token
 * fails fast instead of hanging the MCP server.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { doctorHome } from "./session.js";

/** Clone/push can be slow on big repositories, but must never hang forever. */
const NETWORK_TIMEOUT_MS = 10 * 60_000;

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
  return text
    .replace(/x-access-token:[^@\s]+@/g, "x-access-token:***@")
    .replace(/(AUTHORIZATION: basic )[A-Za-z0-9+/=]+/gi, "$1***")
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, "***");
}

interface GitOptions {
  env?: NodeJS.ProcessEnv;
  timeout?: number;
}

/** Environment for every git call: never prompt for credentials. */
function baseEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", ...extra };
}

/** Run git with an argument array. Throws GitError with stderr on failure. */
export function git(args: string[], cwd: string, opts: GitOptions = {}): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      env: baseEnv(opts.env),
      timeout: opts.timeout,
      maxBuffer: 64 * 1024 * 1024,
    }).trim();
  } catch (err) {
    const e = err as { stderr?: unknown; stdout?: unknown; message?: string; code?: string; signal?: string };
    const timedOut = e.code === "ETIMEDOUT" || e.signal === "SIGTERM";
    const stderr = redact(String(e.stderr ?? "") + String(e.stdout ?? "")).trim();
    const shown = redact(args.join(" "));
    const detail = timedOut ? `timed out after ${Math.round((opts.timeout ?? 0) / 1000)}s` : stderr || redact(e.message ?? "unknown error");
    throw new GitError(`git ${shown} failed: ${detail}`, args, stderr);
  }
}

/** Run git and return exit status (0 = success) without throwing. */
function gitStatusCode(args: string[], cwd: string): number {
  try {
    execFileSync("git", args, { cwd, stdio: ["pipe", "pipe", "pipe"], env: baseEnv() });
    return 0;
  } catch (err) {
    const status = (err as { status?: number }).status;
    return typeof status === "number" ? status : 1;
  }
}

/**
 * git config (via environment) that sends the token as an HTTP Authorization
 * header to `url`'s origin only. Returns undefined when there is no token or
 * the URL is not https.
 */
export function authEnv(url: string, token?: string): NodeJS.ProcessEnv | undefined {
  if (!token || !/^https:\/\//i.test(url)) return undefined;
  const origin = new URL(url).origin;
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `http.${origin}/.extraheader`,
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
  };
}

/** Add an actionable hint to clone/push authentication and permission errors. */
export function networkHint(stderr: string, action: "clone" | "push"): string {
  if (/could not read Username|terminal prompts disabled|Authentication failed|Invalid username or password/i.test(stderr)) {
    return process.env["GITHUB_TOKEN"]
      ? ` Hint: GitHub rejected GITHUB_TOKEN — it may be expired or lack access to this repository.`
      : ` Hint: authentication is required — set GITHUB_TOKEN (repo scope) in the MCP server's env.`;
  }
  if (/Permission to .* denied|403|The requested URL returned error: 403/i.test(stderr)) {
    return ` Hint: GITHUB_TOKEN cannot ${action} to this repository (needs 'repo' scope / Contents write). ` +
      (action === "push" ? "Use a repository you can push to, or fork it and analyse the fork." : "");
  }
  if (/Repository not found|not found/i.test(stderr)) {
    return " Hint: the repository does not exist or the token has no access to it.";
  }
  if (/non-fast-forward|\[rejected\]|fetch first/i.test(stderr)) {
    return " Hint: the remote already has a different version of this branch. Delete the remote branch (or rename it) and retry — Codebase Doctor never force-pushes.";
  }
  if (/Could not resolve host|unable to access|timed out|Connection refused/i.test(stderr)) {
    return " Hint: GitHub could not be reached — check the network connection and retry.";
  }
  return "";
}

// ---------------------------------------------------------------------------
// Clone
// ---------------------------------------------------------------------------

export interface CloneSource {
  /** URL or local path git clones from. */
  cloneFrom: string;
  /** URL to store as `origin` after cloning (tokenless). Defaults to cloneFrom. */
  originUrl?: string;
}

/** <home>/repos/<owner>/<repo>/<sessionId> — the session-owned clone. */
export function clonePath(owner: string, repoName: string, sessionId: string): string {
  return path.join(doctorHome(), "repos", owner || "local", repoName, sessionId);
}

/**
 * Clone a repository into the session directory. If it already contains a
 * clone (session restart), skip cloning. Returns the absolute local path.
 * On failure the partial clone directory is removed.
 */
export function cloneRepo(
  source: CloneSource,
  owner: string,
  repoName: string,
  sessionId: string,
  token?: string
): string {
  const localPath = clonePath(owner, repoName, sessionId);

  if (fs.existsSync(path.join(localPath, ".git"))) {
    return localPath; // already cloned — idempotent
  }

  fs.mkdirSync(localPath, { recursive: true });
  const isLocal = !/^[a-z]+:\/\//i.test(source.cloneFrom);
  // --depth needs a file:// URL for local sources.
  const from = isLocal ? pathToFileURL(path.resolve(source.cloneFrom)).href : source.cloneFrom;
  try {
    git(["clone", "--depth=1", "--no-tags", from, "."], localPath, {
      env: authEnv(source.cloneFrom, token),
      timeout: NETWORK_TIMEOUT_MS,
    });
  } catch (err) {
    fs.rmSync(localPath, { recursive: true, force: true });
    const stderr = err instanceof GitError ? err.stderr : "";
    throw new Error(`Cloning the repository failed: ${(err as Error).message}${networkHint(stderr, "clone")}`);
  }
  if (source.originUrl && source.originUrl !== source.cloneFrom) {
    git(["remote", "set-url", "origin", source.originUrl], localPath);
  }
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

/**
 * Tracked files with uncommitted (staged or unstaged) changes relative to
 * HEAD. Untracked files are ignored — they are not part of HEAD either way,
 * and build output often lands there.
 */
export function uncommittedFiles(localPath: string): string[] {
  return git(["diff", "--name-only", "HEAD"], localPath).split("\n").filter(Boolean);
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
  // git() trims output; restore the first line's leading space so the columns align.
  const out = git(["show", "--stat", "--format=", sha], localPath);
  return out && !out.startsWith(" ") ? ` ${out}` : out;
}

/** Unified diff of one commit (no colour, no commit header). */
export function commitDiff(localPath: string, sha: string): string {
  return git(["show", "--format=", "--no-color", "--unified=3", sha], localPath);
}

/** Files changed between two commits (e.g. migration base → HEAD). */
export function changedFiles(localPath: string, base: string, head = "HEAD"): string[] {
  return git(["diff", "--name-only", base, head], localPath).split("\n").filter(Boolean);
}

/** Restore paths to their HEAD state (used to roll back a failed step). */
export function restorePaths(localPath: string, paths: string[]): void {
  const tracked = paths.filter((p) => gitStatusCode(["ls-files", "--error-unmatch", p], localPath) === 0);
  if (tracked.length > 0) git(["checkout", "HEAD", "--", ...tracked], localPath);
  // Unstage anything a failed commit left in the index for these paths.
  if (tracked.length > 0) gitStatusCode(["reset", "-q", "HEAD", "--", ...tracked], localPath);
}

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

/**
 * Push the branch to origin (never forced). The token travels only in this
 * one command's environment; the stored `origin` remote stays tokenless.
 */
export function pushBranch(localPath: string, branchName: string, token?: string): void {
  const remoteUrl = git(["remote", "get-url", "origin"], localPath);
  try {
    git(["push", "origin", `HEAD:refs/heads/${branchName}`], localPath, {
      env: authEnv(remoteUrl, token),
      timeout: NETWORK_TIMEOUT_MS,
    });
  } catch (err) {
    const stderr = err instanceof GitError ? err.stderr : "";
    throw new Error(`Pushing ${branchName} failed: ${(err as Error).message}${networkHint(stderr, "push")}`);
  }
}

// ---------------------------------------------------------------------------
// Repository introspection
// ---------------------------------------------------------------------------

export function detectDefaultBranch(localPath: string): string {
  try {
    return git(["symbolic-ref", "refs/remotes/origin/HEAD", "--short"], localPath).replace("origin/", "");
  } catch {
    try {
      return currentBranch(localPath);
    } catch {
      return "main";
    }
  }
}

/**
 * The configured URL of `origin`, or null when there is none. Read from the
 * config rather than `git remote get-url`, which applies `url.*.insteadOf`
 * rewrites (e.g. https→ssh) and would hide which GitHub repository it is.
 */
export function originUrl(repoPath: string): string | null {
  try {
    return git(["config", "--get", "remote.origin.url"], repoPath) || null;
  } catch {
    return null;
  }
}
