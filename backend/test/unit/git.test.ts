import { describe, it, expect, afterAll, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stageAndCommit, checkoutNewBranch, currentBranch, git, GitError } from "../../src/lib/git.js";
import { sh, removeDir } from "../helpers.js";

const dirs: string[] = [];
function repo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cd-git-"));
  dirs.push(dir);
  sh(dir, "git", ["init", "-q", "-b", "main"]);
  sh(dir, "git", ["config", "user.email", "test@example.com"]);
  sh(dir, "git", ["config", "user.name", "Test"]);
  fs.writeFileSync(path.join(dir, "a.txt"), "a\n");
  sh(dir, "git", ["add", "-A"]);
  sh(dir, "git", ["commit", "-q", "-m", "init"]);
  return dir;
}
afterAll(() => dirs.forEach(removeDir));

describe("stageAndCommit", () => {
  let dir: string;
  beforeEach(() => {
    dir = repo();
  });

  it("returns committed:false only when there is genuinely nothing to commit", () => {
    expect(stageAndCommit(dir, "noop")).toEqual({ committed: false, sha: null, files: [] });
  });

  it("commits and reports the sha and files", () => {
    fs.writeFileSync(path.join(dir, "a.txt"), "changed\n");
    const r = stageAndCommit(dir, "change a");
    expect(r.committed).toBe(true);
    expect(r.sha).toBe(sh(dir, "git", ["rev-parse", "HEAD"]));
    expect(r.files).toEqual(["a.txt"]);
  });

  it("stages only the given paths", () => {
    fs.writeFileSync(path.join(dir, "a.txt"), "changed\n");
    fs.writeFileSync(path.join(dir, "stray.log"), "x\n");
    const r = stageAndCommit(dir, "only a", ["a.txt", "missing-lockfile.json"]);
    expect(r.files).toEqual(["a.txt"]);
    expect(sh(dir, "git", ["status", "--porcelain"])).toContain("?? stray.log");
  });

  it("never stages node_modules / build output by default", () => {
    fs.mkdirSync(path.join(dir, "node_modules", "react"), { recursive: true });
    fs.writeFileSync(path.join(dir, "node_modules", "react", "package.json"), "{}");
    fs.writeFileSync(path.join(dir, "b.txt"), "b\n");
    expect(stageAndCommit(dir, "add b").files).toEqual(["b.txt"]);
  });

  it("propagates git identity errors with a fix hint", () => {
    sh(dir, "git", ["config", "--unset", "user.email"]);
    sh(dir, "git", ["config", "--unset", "user.name"]);
    sh(dir, "git", ["config", "user.useConfigOnly", "true"]);
    const saved = { g: process.env["GIT_CONFIG_GLOBAL"], s: process.env["GIT_CONFIG_NOSYSTEM"] };
    process.env["GIT_CONFIG_GLOBAL"] = "/dev/null";
    process.env["GIT_CONFIG_NOSYSTEM"] = "1";
    try {
      fs.writeFileSync(path.join(dir, "a.txt"), "changed\n");
      expect(() => stageAndCommit(dir, "x")).toThrow(/git identity/);
    } finally {
      if (saved.g === undefined) delete process.env["GIT_CONFIG_GLOBAL"]; else process.env["GIT_CONFIG_GLOBAL"] = saved.g;
      if (saved.s === undefined) delete process.env["GIT_CONFIG_NOSYSTEM"]; else process.env["GIT_CONFIG_NOSYSTEM"] = saved.s;
    }
  });

  it("propagates hook failures instead of treating them as 'nothing to commit'", () => {
    const hook = path.join(dir, ".git", "hooks", "pre-commit");
    fs.writeFileSync(hook, "#!/bin/sh\necho 'lint failed' >&2\nexit 1\n");
    fs.chmodSync(hook, 0o755);
    fs.writeFileSync(path.join(dir, "a.txt"), "changed\n");
    expect(() => stageAndCommit(dir, "x")).toThrow(/lint failed[\s\S]*hooks/);
    // The change is still staged, not silently dropped.
    expect(sh(dir, "git", ["diff", "--cached", "--name-only"])).toBe("a.txt");
  });

  it("propagates 'not a git repository'", () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), "cd-nogit-"));
    dirs.push(plain);
    expect(() => stageAndCommit(plain, "x")).toThrow(/not a git repository/i);
  });

  it("does not pass commit messages through a shell", () => {
    fs.writeFileSync(path.join(dir, "a.txt"), "changed\n");
    const msg = 'chore: $(touch pwned) `touch pwned2` "quoted"';
    stageAndCommit(dir, msg);
    expect(sh(dir, "git", ["log", "-1", "--format=%s"])).toBe(msg);
    expect(fs.existsSync(path.join(dir, "pwned"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "pwned2"))).toBe(false);
  });
});

describe("checkoutNewBranch", () => {
  it("creates the branch, then switches to it on restart without error", () => {
    const dir = repo();
    expect(checkoutNewBranch(dir, "codebase-doctor/react-18-upgrade")).toBe(true);
    sh(dir, "git", ["checkout", "-q", "main"]);
    expect(checkoutNewBranch(dir, "codebase-doctor/react-18-upgrade")).toBe(false);
    expect(currentBranch(dir)).toBe("codebase-doctor/react-18-upgrade");
  });

  it("propagates real failures (invalid branch name)", () => {
    const dir = repo();
    expect(() => checkoutNewBranch(dir, "bad..name")).toThrow(GitError);
  });
});

describe("git error redaction", () => {
  it("never includes a token in error messages", () => {
    const dir = repo();
    try {
      git(["clone", "/nonexistent/x-access-token:SUPERSECRET@host/repo.git", "out"], dir);
      expect.unreachable();
    } catch (err) {
      expect(String((err as Error).message)).not.toContain("SUPERSECRET");
      expect(String((err as Error).message)).toContain("x-access-token:***@");
    }
  });
});

describe("stage", () => {
  it("works when node_modules exists and is gitignored", () => {
    const dir = repo();
    fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules/\n");
    fs.mkdirSync(path.join(dir, "node_modules", "x"), { recursive: true });
    fs.writeFileSync(path.join(dir, "node_modules", "x", "index.js"), "");
    fs.writeFileSync(path.join(dir, "a.txt"), "changed\n");
    expect(stageAndCommit(dir, "change").files.sort()).toEqual([".gitignore", "a.txt"]);
  });
});
