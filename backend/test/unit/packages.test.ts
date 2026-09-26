import { describe, it, expect, afterEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  planPackageChanges,
  writePackageChanges,
  runInstall,
  checkInstalledVersions,
  setCommandRunner,
  targetRange,
} from "../../src/lib/packages.js";
import { satisfiesCaret, versionGte, selectKnowledgeBase, resolveEcosystem } from "../../src/lib/ecosystem.js";
import { FIXTURE_SRC, copyDirRecursive, fakeInstaller, removeDir } from "../helpers.js";

const dirs: string[] = [];
function fixtureCopy(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cd-pkg-"));
  copyDirRecursive(FIXTURE_SRC, dir);
  dirs.push(dir);
  return dir;
}
function writeJson(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}
afterEach(() => setCommandRunner(null));
afterAll(() => dirs.forEach(removeDir));

describe("planPackageChanges", () => {
  it("upgrades react and react-dom together and leaves unrelated packages alone", () => {
    const changes = planPackageChanges(FIXTURE_SRC, "react", "18.3.1");
    expect(changes).toEqual([
      { name: "react", section: "dependencies", from: "^17.0.2", to: "^18.3.1" },
      { name: "react-dom", section: "dependencies", from: "^17.0.2", to: "^18.3.1" },
    ]);
  });

  it("syncs declared companions (react-test-renderer, @types/*) but never adds packages", () => {
    const dir = fixtureCopy();
    const pkgPath = path.join(dir, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    pkg.devDependencies["react-test-renderer"] = "17.0.2";
    pkg.devDependencies["@types/react"] = "^17.0.0";
    writeJson(pkgPath, pkg);

    const names = planPackageChanges(dir, "react", "18.3.1").map((c) => `${c.name}@${c.to}`);
    expect(names).toEqual(["react@^18.3.1", "react-dom@^18.3.1", "react-test-renderer@^18.3.1", "@types/react@^18"]);
    expect(names.some((n) => n.startsWith("@types/react-dom"))).toBe(false);
    expect(names.some((n) => n.startsWith("@testing-library"))).toBe(false);
  });

  it("targetRange keeps explicit ranges", () => {
    expect(targetRange("18")).toBe("^18");
    expect(targetRange("~18.2.0")).toBe("~18.2.0");
  });
});

describe("writePackageChanges", () => {
  it("writes the planned ranges and preserves indentation", () => {
    const dir = fixtureCopy();
    writePackageChanges(dir, planPackageChanges(dir, "react", "18.3.1"));
    const raw = fs.readFileSync(path.join(dir, "package.json"), "utf8");
    expect(raw).toContain('  "react": "^18.3.1"');
    expect(raw).toContain('  "react-dom": "^18.3.1"');
    expect(raw).toContain('"@testing-library/react": "^12.0.0"');
  });
});

describe("runInstall", () => {
  it("runs `npm install` when a lockfile exists (so it gets updated)", () => {
    const dir = fixtureCopy();
    const fake = fakeInstaller();
    setCommandRunner(fake.runner);
    const r = runInstall(dir, "npm");
    expect(r.ok).toBe(true);
    expect(r.command).toBe("npm install");
    expect(r.lockfile).toBe("package-lock.json");
  });

  it("does not create a lockfile for npm repos without one", () => {
    const dir = fixtureCopy();
    fs.rmSync(path.join(dir, "package-lock.json"));
    const fake = fakeInstaller();
    setCommandRunner(fake.runner);
    expect(runInstall(dir, "npm").command).toBe("npm install --no-package-lock");
    expect(fs.existsSync(path.join(dir, "package-lock.json"))).toBe(false);
  });

  it("uses the repo's package manager", () => {
    const dir = fixtureCopy();
    const fake = fakeInstaller();
    setCommandRunner(fake.runner);
    fs.writeFileSync(path.join(dir, "yarn.lock"), "");
    expect(runInstall(dir, "yarn").command).toBe("yarn install");
    fs.writeFileSync(path.join(dir, "pnpm-lock.yaml"), "");
    expect(runInstall(dir, "pnpm").command).toBe("pnpm install");
  });

  it("reports install failures", () => {
    const dir = fixtureCopy();
    setCommandRunner(fakeInstaller({ fail: true }).runner);
    const r = runInstall(dir, "npm");
    expect(r.ok).toBe(false);
    expect(r.output).toContain("ERESOLVE");
  });
});

describe("checkInstalledVersions", () => {
  function withInstalled(versions: Record<string, string>, target = "18.3.1") {
    const dir = fixtureCopy();
    for (const [name, version] of Object.entries(versions)) {
      writeJson(path.join(dir, "node_modules", name, "package.json"), { name, version });
    }
    return checkInstalledVersions(dir, "react", target);
  }

  it("passes when react and react-dom are installed at the same target version", () => {
    const r = withInstalled({ react: "18.3.1", "react-dom": "18.3.1" });
    expect(r.ok).toBe(true);
    expect(r.installed).toEqual({ react: "18.3.1", "react-dom": "18.3.1" });
  });

  it("fails on stale node_modules (still React 17)", () => {
    const r = withInstalled({ react: "17.0.2", "react-dom": "17.0.2" });
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/react@17\.0\.2 does not satisfy \^18\.3\.1/);
  });

  it("fails when react and react-dom versions differ", () => {
    const r = withInstalled({ react: "18.3.1", "react-dom": "18.2.0" }, "18");
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toMatch(/companion versions differ/);
  });

  it("fails when a declared package is missing from node_modules", () => {
    const r = withInstalled({ react: "18.3.1" });
    expect(r.problems.join(" ")).toMatch(/react-dom is not installed/);
  });
});

describe("version helpers", () => {
  it("satisfiesCaret", () => {
    expect(satisfiesCaret("18.3.1", "18")).toBe(true);
    expect(satisfiesCaret("18.3.1", "^18.3.1")).toBe(true);
    expect(satisfiesCaret("18.2.0", "18.3.1")).toBe(false);
    expect(satisfiesCaret("19.0.0", "18")).toBe(false);
  });

  it("versionGte", () => {
    expect(versionGte("18.3.1", "18.3.0")).toBe(true);
    expect(versionGte("18.2.0", "18.3.0")).toBe(false);
  });

  it("selectKnowledgeBase matches the target major only", () => {
    const eco = resolveEcosystem("react");
    expect(selectKnowledgeBase(eco, "^17.0.2", "18.3.1")?.file).toBe("react-17-to-18.json");
    expect(selectKnowledgeBase(eco, "unknown", "18")?.file).toBe("react-17-to-18.json");
    expect(selectKnowledgeBase(eco, "^18.0.0", "18.3.1")).toBeNull();
  });
});
