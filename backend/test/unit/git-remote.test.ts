/**
 * Clone / push against real local remotes (bare repositories) — no network.
 */

import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { authEnv, cloneRepo, networkHint, pushBranch, uncommittedFiles, originUrl } from "../../src/lib/git.js";
import { removeDir, sh } from "../helpers.js";

// Fake, built at runtime so the source never contains a token-shaped literal (secret scanners).
const FAKE_TOKEN = ["ghp", "_", "x".repeat(36)].join("");

const dirs: string[] = [];
afterAll(() => dirs.forEach(removeDir));

function tmp(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(d);
  return d;
}

function sourceRepo(): string {
  const dir = tmp("cd-src-");
  sh(dir, "git", ["init", "-q", "-b", "main"]);
  sh(dir, "git", ["config", "user.email", "t@example.com"]);
  sh(dir, "git", ["config", "user.name", "T"]);
  fs.writeFileSync(path.join(dir, "a.txt"), "a\n");
  sh(dir, "git", ["add", "-A"]);
  sh(dir, "git", ["commit", "-q", "-m", "init"]);
  return dir;
}

describe("authEnv", () => {
  it("sends the token as an http extraheader via environment, scoped to the remote's origin", () => {
    const env = authEnv("https://github.com/o/r.git", FAKE_TOKEN)!;
    expect(env["GIT_CONFIG_KEY_0"]).toBe("http.https://github.com/.extraheader");
    expect(env["GIT_CONFIG_VALUE_0"]).toMatch(/^AUTHORIZATION: basic [A-Za-z0-9+/=]+$/);
    expect(Buffer.from(env["GIT_CONFIG_VALUE_0"]!.split(" ").pop()!, "base64").toString()).toBe(`x-access-token:${FAKE_TOKEN}`);
    expect(authEnv("https://github.com/o/r.git", undefined)).toBeUndefined();
    expect(authEnv("/local/path", "tok")).toBeUndefined();
  });
});

describe("cloneRepo + pushBranch with a local bare remote", () => {
  it("clones into the session directory, keeps the token out of .git/config, and pushes without forcing", () => {
    const src = sourceRepo();
    const bare = tmp("cd-bare-");
    sh(bare, "git", ["clone", "-q", "--bare", src, "."]);

    const local = cloneRepo({ cloneFrom: bare }, "owner", "repo", "11111111-1111-4111-8111-111111111111", FAKE_TOKEN);
    dirs.push(local);
    expect(fs.readFileSync(path.join(local, ".git", "config"), "utf8")).not.toContain("ghp_");
    expect(originUrl(local)).toMatch(/^file:\/\//);
    // idempotent on restart
    expect(cloneRepo({ cloneFrom: bare }, "owner", "repo", "11111111-1111-4111-8111-111111111111")).toBe(local);

    sh(local, "git", ["config", "user.email", "t@example.com"]);
    sh(local, "git", ["config", "user.name", "T"]);
    sh(local, "git", ["checkout", "-q", "-b", "codebase-doctor/react-18-upgrade"]);
    fs.writeFileSync(path.join(local, "a.txt"), "changed\n");
    expect(uncommittedFiles(local)).toEqual(["a.txt"]);
    sh(local, "git", ["commit", "-qam", "migrate"]);
    expect(uncommittedFiles(local)).toEqual([]);

    pushBranch(local, "codebase-doctor/react-18-upgrade");
    // --git-dir: some git configs set safe.bareRepository=explicit
    expect(sh(os.tmpdir(), "git", ["--git-dir", bare, "rev-parse", "codebase-doctor/react-18-upgrade"])).toBe(sh(local, "git", ["rev-parse", "HEAD"]));

    // Re-pushing the same commit is a no-op (safe retry after a failed PR call).
    pushBranch(local, "codebase-doctor/react-18-upgrade");

    // A diverged remote branch is never overwritten: the error explains what to do.
    sh(local, "git", ["commit", "-q", "--amend", "-m", "rewritten"]);
    expect(() => pushBranch(local, "codebase-doctor/react-18-upgrade")).toThrow(/Pushing codebase-doctor\/react-18-upgrade failed[\s\S]*never force-pushes/);
  });

  it("a failed clone leaves no partial directory and explains the failure", () => {
    const missing = path.join(tmp("cd-missing-"), "does-not-exist");
    const id = "22222222-2222-4222-8222-222222222222";
    expect(() => cloneRepo({ cloneFrom: missing }, "o", "r", id)).toThrow(/Cloning the repository failed/);
    expect(fs.existsSync(path.join(process.env["CODEBASE_DOCTOR_HOME"]!, "repos", "o", "r", id))).toBe(false);
  });
});

describe("networkHint", () => {
  it.each([
    ["fatal: could not read Username for 'https://github.com': terminal prompts disabled", "clone", /authentication is required — set GITHUB_TOKEN/],
    ["remote: Permission to o/r.git denied to someone.\nfatal: unable to access: The requested URL returned error: 403", "push", /cannot push[\s\S]*fork it/],
    ["remote: Repository not found.", "clone", /does not exist or the token has no access/],
    [" ! [rejected]        HEAD -> x (non-fast-forward)", "push", /never force-pushes/],
    ["fatal: unable to access 'https://github.com/o/r/': Could not resolve host: github.com", "clone", /could not be reached/],
  ] as const)("%s", (stderr, action, expected) => {
    const saved = process.env["GITHUB_TOKEN"];
    delete process.env["GITHUB_TOKEN"];
    try {
      expect(networkHint(stderr, action)).toMatch(expected);
    } finally {
      if (saved !== undefined) process.env["GITHUB_TOKEN"] = saved;
    }
  });
});
