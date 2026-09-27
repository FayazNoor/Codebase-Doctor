/**
 * Input validation for the values that flow into git, the package manager and
 * the GitHub API: repository sources, package names, target versions and the
 * migration branch name.
 *
 * Every validator throws an Error whose message says what was wrong and what
 * is accepted, so Bob can relay it to the user unchanged.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Repository source
// ---------------------------------------------------------------------------

export type RepoSource =
  | { kind: "github"; owner: string; repo: string; cloneUrl: string; webUrl: string }
  | { kind: "local"; path: string };

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;

const ACCEPTED =
  "Accepted: https://github.com/<owner>/<repo> (optionally .git), git@github.com:<owner>/<repo>.git, " +
  "or an absolute path to a local git repository.";

/**
 * Parse what the user typed as "the repository". GitHub URLs may carry a
 * trailing slash, `.git`, or a deeper path such as `/tree/main/src`; repo names
 * may contain dots (`vercel/next.js`). Hosts other than github.com are rejected.
 */
export function parseRepoSource(input: string): RepoSource {
  const raw = input.trim();
  if (raw === "") throw new Error(`No repository given. ${ACCEPTED}`);

  const gh = parseGitHubRef(raw);
  if (gh) return gh;

  const local = localRepoPath(raw);
  if (local) return { kind: "local", path: local };

  if (/^[a-z]+:\/\//i.test(raw) || /^[\w.-]+@[\w.-]+:/.test(raw)) {
    throw new Error(`Unsupported repository URL '${raw}': only github.com repositories are supported. ${ACCEPTED}`);
  }
  throw new Error(`'${raw}' is neither a GitHub repository URL nor an existing local git repository. ${ACCEPTED}`);
}

/** Parse a github.com URL (https, http, ssh, or scheme-less). Returns null if it is not one. */
export function parseGitHubRef(raw: string): Extract<RepoSource, { kind: "github" }> | null {
  let rest: string | null = null;
  const ssh = raw.match(/^(?:ssh:\/\/)?git@github\.com[:/](.+)$/i);
  if (ssh) rest = ssh[1];
  else {
    const http = raw.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/(.+)$/i);
    if (http) rest = http[1];
  }
  if (rest === null) return null;

  rest = rest.split(/[?#]/)[0];
  const [owner, repoRaw] = rest.split("/");
  const repo = (repoRaw ?? "").replace(/\.git$/i, "");
  if (!owner || !repo || !OWNER.test(owner) || !REPO.test(repo) || repo === "." || repo === "..") {
    throw new Error(`Cannot parse GitHub repository from '${raw}'. ${ACCEPTED}`);
  }
  return {
    kind: "github",
    owner,
    repo,
    cloneUrl: `https://github.com/${owner}/${repo}.git`,
    webUrl: `https://github.com/${owner}/${repo}`,
  };
}

function localRepoPath(raw: string): string | null {
  let p = raw;
  if (/^file:\/\//i.test(p)) {
    try {
      p = fileURLToPath(p);
    } catch {
      return null;
    }
  }
  if (!path.isAbsolute(p)) return null;
  const resolved = path.resolve(p);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Local repository path '${resolved}' does not exist.`);
  }
  if (!fs.existsSync(path.join(resolved, ".git"))) {
    throw new Error(`'${resolved}' is not a git repository (no .git). Initialise it with git or pass a GitHub URL.`);
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Package name and version
// ---------------------------------------------------------------------------

const NPM_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

/** Validate an npm package name (as written in package.json). */
export function validatePackageName(name: string): string {
  const n = name.trim();
  if (!n || n.length > 214 || !NPM_NAME.test(n)) {
    throw new Error(`'${name}' is not a valid npm package name (e.g. 'react', '@types/react').`);
  }
  return n;
}

/**
 * Normalise a target version. Accepts "18", "18.3", "18.3.1", "^18.3.1",
 * "~18.3.1", "18.x", "18.0.0-rc.3". Rejects tags and complex ranges
 * ("latest", ">=18 <19") because the upgrade needs one concrete target.
 */
export function normaliseTargetVersion(version: string): string {
  const v = version.trim().replace(/^v(?=\d)/, "").replace(/(\.x)+$/i, "");
  if (!/^[\^~]?\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z.-]+)?$/.test(v)) {
    throw new Error(
      `Target version '${version}' is not supported. Use a version like '18', '18.3.1' or '^18.3.1' ` +
        `(dist-tags such as 'latest' and ranges such as '>=18' are not accepted).`
    );
  }
  return v;
}

// ---------------------------------------------------------------------------
// Branch name
// ---------------------------------------------------------------------------

/**
 * Migration branch name that is always a valid git ref:
 * react + ^18.3.1 → codebase-doctor/react-18.3.1-upgrade,
 * @types/react + 18 → codebase-doctor/types-react-18-upgrade.
 */
export function migrationBranchName(dependency: string, targetVersion: string): string {
  const dep = dependency.replace(/^@/, "").replace(/\//g, "-").replace(/[^A-Za-z0-9._-]/g, "-");
  const ver = targetVersion.replace(/^[\^~]/, "").replace(/[^A-Za-z0-9._-]/g, "-");
  const name = `codebase-doctor/${dep}-${ver}-upgrade`.replace(/\.{2,}/g, ".").replace(/\.lock\b/g, "-lock");
  return name;
}
