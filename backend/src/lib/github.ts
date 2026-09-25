/**
 * GitHub API wrapper — thin Octokit helper.
 * All methods throw with an actionable message on failure.
 */

import { Octokit } from "@octokit/rest";

let _octokit: Octokit | null = null;

function getOctokit(): Octokit {
  if (!_octokit) {
    const token = process.env["GITHUB_TOKEN"];
    if (!token) {
      throw new Error(
        "GITHUB_TOKEN environment variable is not set. " +
          "Set it to a Personal Access Token with 'repo' scope."
      );
    }
    _octokit = new Octokit({ auth: token });
  }
  return _octokit;
}

// ---------------------------------------------------------------------------
// Repository info
// ---------------------------------------------------------------------------

export async function getRepoInfo(owner: string, repo: string) {
  const { data } = await getOctokit().repos.get({ owner, repo });
  return {
    defaultBranch: data.default_branch,
    fullName: data.full_name,
    cloneUrl: data.clone_url,
  };
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

export async function createPr(opts: CreatePrOptions): Promise<string> {
  const { data } = await getOctokit().pulls.create({
    owner: opts.owner,
    repo: opts.repo,
    head: opts.head,
    base: opts.base,
    title: opts.title,
    body: opts.body,
  });

  // Add standard labels (best-effort — don't fail if labels don't exist)
  try {
    await getOctokit().issues.addLabels({
      owner: opts.owner,
      repo: opts.repo,
      issue_number: data.number,
      labels: ["codebase-doctor", "dependencies"],
    });
  } catch {
    // Labels may not exist in the target repo — not a fatal error
  }

  return data.html_url;
}

// ---------------------------------------------------------------------------
// Parse owner/repo from URL
// ---------------------------------------------------------------------------

export function parseGitHubUrl(url: string): { owner: string; repo: string } {
  // Handles:
  //   https://github.com/owner/repo
  //   https://github.com/owner/repo.git
  //   git@github.com:owner/repo.git
  const match = url.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
  if (!match) {
    throw new Error(
      `Cannot parse GitHub URL: '${url}'. Expected format: https://github.com/owner/repo`
    );
  }
  return { owner: match[1], repo: match[2] };
}
