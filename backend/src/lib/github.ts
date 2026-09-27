/**
 * GitHub API wrapper — thin Octokit helper.
 *
 * - Reading public repository metadata works without a token (GitHub allows
 *   60 unauthenticated requests/hour); pushing and opening PRs need GITHUB_TOKEN.
 * - GITHUB_API_URL overrides the API base URL (GitHub Enterprise Server, or a
 *   local mock for tests/sandboxes). Defaults to https://api.github.com.
 * - Every failure is rethrown as a GitHubApiError with an actionable message
 *   (not found / bad credentials / missing permission / rate limit / network).
 */

import { Octokit } from "@octokit/rest";
import { parseGitHubRef } from "./validation.js";

const REQUEST_TIMEOUT_MS = 30_000;

let cached: { key: string; client: Octokit } | null = null;

function getOctokit(requireToken: boolean): Octokit {
  const token = process.env["GITHUB_TOKEN"] || undefined;
  if (requireToken && !token) {
    throw new GitHubApiError(
      "GITHUB_TOKEN is not set. Pushing the branch and opening a pull request need a Personal Access Token " +
        "with 'repo' scope (fine-grained: Contents + Pull requests read/write) in the MCP server's env.",
      null
    );
  }
  const baseUrl = process.env["GITHUB_API_URL"] || "https://api.github.com";
  const key = `${baseUrl}|${token ?? ""}`;
  if (!cached || cached.key !== key) {
    // Octokit must never log: stdout carries the MCP protocol, and failures are
    // turned into actionable errors by describeGitHubError instead.
    const silent = () => undefined;
    cached = {
      key,
      client: new Octokit({ auth: token, baseUrl, userAgent: "codebase-doctor", log: { debug: silent, info: silent, warn: silent, error: silent } }),
    };
  }
  return cached.client;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class GitHubApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

interface OctokitLikeError {
  status?: number;
  message?: string;
  response?: { headers?: Record<string, string | number | undefined>; data?: { message?: string; errors?: Array<{ message?: string }> } };
  code?: string;
  name?: string;
}

/** Translate an Octokit/network error into an actionable GitHubApiError. */
export function describeGitHubError(err: unknown, action: string, repo: string): GitHubApiError {
  const e = (err ?? {}) as OctokitLikeError;
  const status = typeof e.status === "number" ? e.status : null;
  const apiMessage = [e.response?.data?.message, ...(e.response?.data?.errors ?? []).map((x) => x.message)]
    .filter(Boolean)
    .join("; ");
  const hasToken = Boolean(process.env["GITHUB_TOKEN"]);
  const headers = e.response?.headers ?? {};

  if (status === 404) {
    return new GitHubApiError(
      `${action} failed: repository '${repo}' was not found` +
        (hasToken
          ? " or GITHUB_TOKEN has no access to it. Check the URL and the token's repository access."
          : ". If it is private, set GITHUB_TOKEN (repo scope) in the MCP server's env."),
      status
    );
  }
  if (status === 401) {
    return new GitHubApiError(
      `${action} failed: GitHub rejected GITHUB_TOKEN (bad or expired credentials). Create a new token and update the MCP server config.`,
      status
    );
  }
  if (status === 403 || status === 429) {
    const remaining = headers["x-ratelimit-remaining"];
    if (String(remaining) === "0" || status === 429 || /rate limit/i.test(apiMessage)) {
      const reset = Number(headers["x-ratelimit-reset"]);
      const when = Number.isFinite(reset) && reset > 0 ? ` Resets at ${new Date(reset * 1000).toISOString()}.` : "";
      return new GitHubApiError(
        `${action} failed: GitHub API rate limit exceeded.${when}` + (hasToken ? "" : " Setting GITHUB_TOKEN raises the limit."),
        status
      );
    }
    return new GitHubApiError(
      `${action} failed: GITHUB_TOKEN lacks permission for '${repo}'${apiMessage ? ` (${apiMessage})` : ""}. ` +
        "It needs 'repo' scope (fine-grained: Contents and Pull requests read/write).",
      status
    );
  }
  if (status === 422) {
    return new GitHubApiError(`${action} failed: GitHub rejected the request (${apiMessage || e.message || "validation failed"}).`, status);
  }
  if (status !== null && status >= 500) {
    return new GitHubApiError(`${action} failed: GitHub returned ${status}. Retry in a moment.`, status);
  }
  const network = e.code ?? e.name ?? "";
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|AbortError|TimeoutError|fetch failed/i.test(`${network} ${e.message ?? ""}`)) {
    return new GitHubApiError(`${action} failed: could not reach the GitHub API (${e.message ?? network}). Check the network connection.`, null);
  }
  return new GitHubApiError(`${action} failed: ${e.message ?? String(err)}`, status);
}

async function call<T>(action: string, repo: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof GitHubApiError) throw err;
    throw describeGitHubError(err, action, repo);
  }
}

const signal = () => ({ request: { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) } });

// ---------------------------------------------------------------------------
// Repository info
// ---------------------------------------------------------------------------

export interface RepoMetadata {
  defaultBranch: string;
  fullName: string;
  cloneUrl: string;
  private: boolean;
  archived: boolean;
}

/** Repository metadata. Works without a token for public repositories. */
export async function getRepoInfo(owner: string, repo: string): Promise<RepoMetadata> {
  return call("Reading repository metadata", `${owner}/${repo}`, async () => {
    const { data } = await getOctokit(false).repos.get({ owner, repo, ...signal() });
    return {
      defaultBranch: data.default_branch,
      fullName: data.full_name,
      cloneUrl: data.clone_url,
      private: data.private,
      archived: data.archived,
    };
  });
}

// ---------------------------------------------------------------------------
// Pull request
// ---------------------------------------------------------------------------

export interface CreatePrOptions {
  owner: string;
  repo: string;
  head: string;
  base: string;
  title: string;
  body: string;
}

export interface PrRef {
  url: string;
  number: number;
}

/** Return an already-open PR for `head` → `base`, if any (prevents duplicates on retry). */
export async function findOpenPr(owner: string, repo: string, head: string, base: string): Promise<PrRef | null> {
  return call("Looking up existing pull requests", `${owner}/${repo}`, async () => {
    const { data } = await getOctokit(true).pulls.list({ owner, repo, head: `${owner}:${head}`, base, state: "open", ...signal() });
    const pr = data[0];
    return pr ? { url: pr.html_url, number: pr.number } : null;
  });
}

export async function createPr(opts: CreatePrOptions): Promise<PrRef> {
  const repoName = `${opts.owner}/${opts.repo}`;
  const data = await call("Opening the pull request", repoName, async () => {
    const res = await getOctokit(true).pulls.create({
      owner: opts.owner,
      repo: opts.repo,
      head: opts.head,
      base: opts.base,
      title: opts.title,
      body: opts.body,
      ...signal(),
    });
    return res.data;
  });

  // Add standard labels (best-effort — labels may not exist or the token may not be allowed to create them)
  try {
    await getOctokit(true).issues.addLabels({
      owner: opts.owner,
      repo: opts.repo,
      issue_number: data.number,
      labels: ["codebase-doctor", "dependencies"],
      ...signal(),
    });
  } catch {
    // Not fatal.
  }

  return { url: data.html_url, number: data.number };
}

// ---------------------------------------------------------------------------
// Parse owner/repo from URL
// ---------------------------------------------------------------------------

/** owner/repo from a GitHub URL (https, ssh, with or without .git). Throws for other hosts. */
export function parseGitHubUrl(url: string): { owner: string; repo: string } {
  const ref = parseGitHubRef(url.trim());
  if (!ref) {
    throw new Error(`Cannot parse GitHub URL: '${url}'. Expected format: https://github.com/owner/repo`);
  }
  return { owner: ref.owner, repo: ref.repo };
}
