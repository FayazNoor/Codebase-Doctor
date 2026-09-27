/**
 * Input validation: repository sources, package names, target versions,
 * branch names, and GitHub API error translation.
 */

import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  parseRepoSource,
  validatePackageName,
  normaliseTargetVersion,
  migrationBranchName,
} from "../../src/lib/validation.js";
import { describeGitHubError, parseGitHubUrl } from "../../src/lib/github.js";
import { removeDir, sh } from "../helpers.js";

const dirs: string[] = [];
afterAll(() => dirs.forEach(removeDir));

describe("parseRepoSource — GitHub", () => {
  it.each([
    ["https://github.com/facebook/react", "facebook", "react"],
    ["https://github.com/facebook/react.git", "facebook", "react"],
    ["https://github.com/facebook/react/", "facebook", "react"],
    ["https://github.com/facebook/react/tree/main/packages", "facebook", "react"],
    ["http://www.github.com/facebook/react?tab=readme", "facebook", "react"],
    ["github.com/facebook/react", "facebook", "react"],
    ["git@github.com:facebook/react.git", "facebook", "react"],
    ["ssh://git@github.com/facebook/react.git", "facebook", "react"],
    // Dots in repository names used to be cut off ("next.js" → "next").
    ["https://github.com/vercel/next.js", "vercel", "next.js"],
    ["  https://github.com/a-b/c_d.e-f  ", "a-b", "c_d.e-f"],
  ])("%s → %s/%s", (url, owner, repo) => {
    const src = parseRepoSource(url);
    expect(src).toMatchObject({ kind: "github", owner, repo, cloneUrl: `https://github.com/${owner}/${repo}.git` });
  });

  it.each([
    ["", /No repository given/],
    ["https://gitlab.com/a/b", /only github.com repositories are supported/],
    ["https://evil.example/github.com/a/b", /only github.com repositories are supported/],
    ["https://github.com/onlyowner", /Cannot parse GitHub repository/],
    ["https://github.com/-bad/repo", /Cannot parse GitHub repository/],
    ["https://github.com/owner/..", /Cannot parse GitHub repository/],
    ["not a url", /neither a GitHub repository URL nor an existing local git repository/],
  ])("rejects %j", (input, message) => {
    expect(() => parseRepoSource(input)).toThrow(message);
  });

  it("parseGitHubUrl keeps working for existing callers", () => {
    expect(parseGitHubUrl("https://github.com/vercel/next.js.git")).toEqual({ owner: "vercel", repo: "next.js" });
    expect(() => parseGitHubUrl("https://gitlab.com/a/b")).toThrow(/Cannot parse GitHub URL/);
  });
});

describe("parseRepoSource — local repositories", () => {
  it("accepts an absolute path (and a file:// URL) to a git repository", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cd-local-"));
    dirs.push(dir);
    sh(dir, "git", ["init", "-q"]);
    expect(parseRepoSource(dir)).toEqual({ kind: "local", path: path.resolve(dir) });
    expect(parseRepoSource(pathToFileURL(dir).href)).toEqual({ kind: "local", path: path.resolve(dir) });
  });

  it("rejects missing paths and folders that are not git repositories", () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), "cd-plain-"));
    dirs.push(plain);
    expect(() => parseRepoSource(plain)).toThrow(/is not a git repository/);
    expect(() => parseRepoSource(path.join(plain, "missing"))).toThrow(/does not exist/);
  });
});

describe("package name and version", () => {
  it("accepts npm package names and rejects anything that could reach a shell or ref", () => {
    expect(validatePackageName("react")).toBe("react");
    expect(validatePackageName(" @types/react ")).toBe("@types/react");
    for (const bad of ["React", "react dom", "react;rm -rf /", "../react", "", "a".repeat(215)]) {
      expect(() => validatePackageName(bad)).toThrow(/not a valid npm package name/);
    }
  });

  it("normalises concrete targets and rejects tags and ranges", () => {
    expect(normaliseTargetVersion("18")).toBe("18");
    expect(normaliseTargetVersion("v18.3.1")).toBe("18.3.1");
    expect(normaliseTargetVersion("^18.3.1")).toBe("^18.3.1");
    expect(normaliseTargetVersion("18.x")).toBe("18");
    expect(normaliseTargetVersion("18.0.0-rc.3")).toBe("18.0.0-rc.3");
    for (const bad of ["latest", ">=18", "18 || 19", "next", ""]) {
      expect(() => normaliseTargetVersion(bad)).toThrow(/not supported/);
    }
  });
});

describe("migrationBranchName", () => {
  it("always produces a valid git ref (previously '^18' and scoped names broke checkout)", () => {
    const cases: Array<[string, string, string]> = [
      ["react", "18.3.1", "codebase-doctor/react-18.3.1-upgrade"],
      ["react", "^18", "codebase-doctor/react-18-upgrade"],
      ["react", "~18.2.0", "codebase-doctor/react-18.2.0-upgrade"],
      ["@types/react", "18", "codebase-doctor/types-react-18-upgrade"],
    ];
    for (const [dep, version, expected] of cases) {
      const name = migrationBranchName(dep, version);
      expect(name).toBe(expected);
      // git itself agrees the name is valid
      execFileSync("git", ["check-ref-format", "--branch", name]);
    }
  });
});

describe("describeGitHubError", () => {
  const withToken = (value: string | undefined, fn: () => void) => {
    const saved = process.env["GITHUB_TOKEN"];
    if (value === undefined) delete process.env["GITHUB_TOKEN"];
    else process.env["GITHUB_TOKEN"] = value;
    try {
      fn();
    } finally {
      if (saved === undefined) delete process.env["GITHUB_TOKEN"];
      else process.env["GITHUB_TOKEN"] = saved;
    }
  };

  it("404 without a token suggests setting one for private repos", () => {
    withToken(undefined, () => {
      const e = describeGitHubError({ status: 404, message: "Not Found" }, "Reading repository metadata", "o/r");
      expect(e.message).toMatch(/'o\/r' was not found\. If it is private, set GITHUB_TOKEN/);
      expect(e.status).toBe(404);
    });
  });

  it("404 with a token points at access, 401 at bad credentials", () => {
    withToken("x", () => {
      expect(describeGitHubError({ status: 404 }, "A", "o/r").message).toMatch(/GITHUB_TOKEN has no access/);
      expect(describeGitHubError({ status: 401 }, "A", "o/r").message).toMatch(/rejected GITHUB_TOKEN/);
    });
  });

  it("403 distinguishes rate limits (with reset time) from missing permissions", () => {
    withToken(undefined, () => {
      const rate = describeGitHubError(
        { status: 403, response: { headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1893456000" } } },
        "A",
        "o/r"
      );
      expect(rate.message).toMatch(/rate limit exceeded\. Resets at 2030-01-01T00:00:00\.000Z\. Setting GITHUB_TOKEN raises the limit/);
    });
    withToken("x", () => {
      const perm = describeGitHubError(
        { status: 403, response: { headers: {}, data: { message: "Resource not accessible by personal access token" } } },
        "Opening the pull request",
        "o/r"
      );
      expect(perm.message).toMatch(/lacks permission for 'o\/r' \(Resource not accessible/);
    });
  });

  it("422 carries GitHub's validation message; network errors say so", () => {
    const v = describeGitHubError(
      { status: 422, response: { data: { message: "Validation Failed", errors: [{ message: "A pull request already exists" }] } } },
      "Opening the pull request",
      "o/r"
    );
    expect(v.message).toMatch(/Validation Failed; A pull request already exists/);
    expect(describeGitHubError({ code: "ENOTFOUND", message: "getaddrinfo ENOTFOUND api.github.com" }, "A", "o/r").message).toMatch(
      /could not reach the GitHub API/
    );
  });
});
