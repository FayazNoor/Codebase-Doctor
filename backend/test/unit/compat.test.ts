/**
 * Peer-dependency preflight (lib/compat.ts), package-manager detection and
 * install-failure diagnosis (lib/packages.ts). No network: the registry is
 * replaced with an in-memory fetcher.
 */

import { describe, it, expect, afterAll, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkPeerCompatibility, checkTargetExists, setRegistryFetcher, lowestCompatible, targetVersionFor, type Packument } from "../../src/lib/compat.js";
import { resolveEcosystem } from "../../src/lib/ecosystem.js";
import { detectPackageManager, diagnoseInstallFailure, planPackageChanges } from "../../src/lib/packages.js";
import { removeDir } from "../helpers.js";

const dirs: string[] = [];
afterAll(() => dirs.forEach(removeDir));
afterEach(() => {
  setRegistryFetcher(null);
  process.env["CODEBASE_DOCTOR_OFFLINE"] = "1";
});

function repo(files: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cd-compat-"));
  dirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, typeof content === "string" ? content : JSON.stringify(content, null, 2));
  }
  return dir;
}

const react = resolveEcosystem("react");

describe("checkPeerCompatibility — lockfile", () => {
  const pkg = {
    dependencies: { react: "^17.0.2", "react-dom": "^17.0.2", "react-redux": "^5.0.7", "react-router-dom": "^5.3.4" },
    devDependencies: { "react-test-renderer": "^17.0.2" },
  };
  const lock = {
    lockfileVersion: 3,
    packages: {
      "": { dependencies: pkg.dependencies },
      "node_modules/react": { version: "17.0.2" },
      "node_modules/react-dom": { version: "17.0.2", peerDependencies: { react: "17.0.2" } },
      "node_modules/react-test-renderer": { version: "17.0.2", peerDependencies: { react: "17.0.2" } },
      "node_modules/react-redux": { version: "5.1.2", peerDependencies: { react: "^0.14.0 || ^15.0.0-0 || ^16.0.0-0", redux: "^2.0.0 || ^3.0.0 || ^4.0.0-0" } },
      "node_modules/react-router-dom": { version: "5.3.4", peerDependencies: { react: ">=15" } },
      "node_modules/some-lib": { version: "1.0.0", peerDependencies: { react: "^16.0.0" }, peerDependenciesMeta: { react: { optional: true } } },
      "node_modules/deep/node_modules/old-widget": { version: "2.0.0", peerDependencies: { "react-dom": "^16.8.0" } },
    },
  };

  it("finds declared and transitive packages whose peer range excludes the target — offline", async () => {
    const dir = repo({ "package.json": pkg, "package-lock.json": lock });
    const report = await checkPeerCompatibility({ repoPath: dir, ecosystem: react, toVersion: "18.3.1" });
    expect(report.checked).toBe(true);
    expect(report.method).toBe("package-lock.json (lockfileVersion 3)");
    expect(report.conflicts.map((c) => [c.name, c.version, c.section, c.peer, c.source])).toEqual([
      ["old-widget", "2.0.0", null, "react-dom", "lockfile"],
      ["react-redux", "5.1.2", "dependencies", "react", "lockfile"],
    ]);
    // react-dom / react-test-renderer are upgraded in lock-step → never conflicts;
    // react-router-dom (>=15) is compatible; optional peers are ignored.
  });

  it("suggests the lowest compatible release from the registry when online", async () => {
    delete process.env["CODEBASE_DOCTOR_OFFLINE"];
    const packument: Packument = {
      versions: {
        "5.1.2": { peerDependencies: { react: "^0.14.0 || ^15.0.0-0 || ^16.0.0-0" } },
        "7.2.8": { peerDependencies: { react: "^16.8.3 || ^17" } },
        "7.2.9": { peerDependencies: { react: "^16.8.3 || ^17 || ^18" } },
        "8.1.3": { peerDependencies: { react: "^16.8 || ^17.0 || ^18.0" } },
        "9.0.0-beta.1": { peerDependencies: { react: "^18" } },
      },
    };
    const asked: string[] = [];
    setRegistryFetcher(async (name) => {
      asked.push(name);
      return name === "react-redux" ? packument : null;
    });
    const dir = repo({ "package.json": pkg, "package-lock.json": lock });
    const report = await checkPeerCompatibility({ repoPath: dir, ecosystem: react, toVersion: "18.3.1" });
    expect(report.conflicts.find((c) => c.name === "react-redux")!.suggestion).toBe("^7.2.9");
    expect(report.conflicts.find((c) => c.name === "react-redux")!.autoUpgrade).toBe(false);
    expect(asked).toContain("react-redux");
  });
});

describe("checkPeerCompatibility — without a lockfile", () => {
  it("uses the npm registry (newest release matching the declared range)", async () => {
    delete process.env["CODEBASE_DOCTOR_OFFLINE"];
    setRegistryFetcher(async (name) =>
      name === "react-redux"
        ? { versions: { "5.0.7": { peerDependencies: { react: "^16" } }, "5.1.2": { peerDependencies: { react: "^16" } }, "7.2.9": { peerDependencies: { react: "^18" } } } }
        : name === "redux"
          ? { versions: { "4.2.1": {} } }
          : null
    );
    const dir = repo({ "package.json": { dependencies: { react: "^16.3.0", "react-dom": "^16.3.0", "react-redux": "^5.0.7", redux: "^4.0.0" } } });
    const report = await checkPeerCompatibility({ repoPath: dir, ecosystem: react, toVersion: "18.3.1" });
    expect(report.method).toMatch(/npm registry/);
    expect(report.conflicts).toEqual([
      expect.objectContaining({ name: "react-redux", version: "5.1.2", peer: "react", range: "^16", source: "registry", suggestion: "^7.2.9" }),
    ]);
  });

  it("offline: says what was not checked instead of claiming 'no conflicts'", async () => {
    const dir = repo({ "package.json": { dependencies: { react: "^16.3.0", "react-dom": "^16.3.0", "react-redux": "^5.0.7" } } });
    const report = await checkPeerCompatibility({ repoPath: dir, ecosystem: react, toVersion: "18.3.1" });
    expect(report.checked).toBe(false);
    expect(report.conflicts).toEqual([]);
    expect(report.note).toMatch(/offline — 1 declared package\(s\) not checked/);
  });

  it("known companions work offline: @testing-library/react 12 is upgraded to ^14.3.1 automatically", async () => {
    const dir = repo({
      "package.json": {
        dependencies: { react: "^17.0.2", "react-dom": "^17.0.2" },
        devDependencies: { "@testing-library/react": "^12.1.5", "@testing-library/react-hooks": "^8.0.1" },
      },
    });
    const report = await checkPeerCompatibility({ repoPath: dir, ecosystem: react, toVersion: "18.3.1" });
    const rtl = report.conflicts.find((c) => c.name === "@testing-library/react")!;
    expect(rtl).toMatchObject({ source: "known", suggestion: "^14.3.1", autoUpgrade: true, section: "devDependencies" });
    const hooks = report.conflicts.find((c) => c.name === "@testing-library/react-hooks")!;
    expect(hooks).toMatchObject({ autoUpgrade: false, suggestion: null });
    expect(hooks.range).toMatch(/renderHook/);

    // The dependency step picks up the curated upgrade — and only that.
    const changes = planPackageChanges(dir, "react", "18.3.1", report.conflicts);
    expect(changes.map((c) => `${c.name}:${c.to}:${c.reason}`)).toEqual([
      "react:^18.3.1:target",
      "react-dom:^18.3.1:companion",
      "@testing-library/react:^14.3.1:peer-compat",
    ]);
  });

  it("an already-compatible companion is not reported", async () => {
    const dir = repo({ "package.json": { dependencies: { react: "^17.0.2" }, devDependencies: { "@testing-library/react": "^13.4.0" } } });
    const report = await checkPeerCompatibility({ repoPath: dir, ecosystem: react, toVersion: "18.3.1" });
    expect(report.conflicts).toEqual([]);
  });
});

describe("checkTargetExists", () => {
  const react: Packument = { versions: { "17.0.2": {}, "18.2.0": {}, "18.3.1": {}, "19.0.0-rc.1": {}, "19.1.0": {} } };

  it("confirms a published target and names the newest release in its major when it is not", async () => {
    delete process.env["CODEBASE_DOCTOR_OFFLINE"];
    setRegistryFetcher(async () => react);
    expect(await checkTargetExists("react", "18.3.1")).toEqual({ checked: true, exists: true, newestInMajor: "18.3.1", newest: "19.1.0" });
    expect(await checkTargetExists("react", "18")).toMatchObject({ exists: true });
    expect(await checkTargetExists("react", "18.99.0")).toEqual({ checked: true, exists: false, newestInMajor: "18.3.1", newest: "19.1.0" });
    expect(await checkTargetExists("react", "25")).toMatchObject({ exists: false, newestInMajor: null, newest: "19.1.0" });
  });

  it("does not guess when offline or when the registry is unreachable", async () => {
    setRegistryFetcher(async () => react);
    expect((await checkTargetExists("react", "18.99.0")).checked).toBe(false); // CODEBASE_DOCTOR_OFFLINE=1
    delete process.env["CODEBASE_DOCTOR_OFFLINE"];
    setRegistryFetcher(async () => null);
    expect((await checkTargetExists("react", "18.99.0")).checked).toBe(false);
  });
});

describe("compat helpers", () => {
  it("targetVersionFor resolves the concrete version peers are checked against", () => {
    expect(targetVersionFor("18")).toBe("18.0.0");
    expect(targetVersionFor("18.3.1")).toBe("18.3.1");
    expect(targetVersionFor("^18.2.0")).toBe("18.2.0");
  });

  it("lowestCompatible skips prereleases, deprecated releases and older versions", () => {
    const p: Packument = {
      versions: {
        "1.0.0": { peerDependencies: { react: "^18" } },
        "2.0.0": { peerDependencies: { react: "^17" } },
        "2.1.0": { peerDependencies: { react: "^18" }, deprecated: "broken" },
        "2.2.0-rc.1": { peerDependencies: { react: "^18" } },
        "2.2.0": { peerDependencies: { react: "^17 || ^18" } },
      },
    };
    expect(lowestCompatible(p, "react", "18.3.1", "2.0.0")).toBe("2.2.0");
  });
});

describe("detectPackageManager", () => {
  it("prefers the packageManager field, then the lockfile, then npm", () => {
    expect(detectPackageManager(repo({ "package.json": { packageManager: "pnpm@9.1.0" } }))).toMatchObject({ pm: "pnpm", warnings: [] });
    expect(detectPackageManager(repo({ "package.json": {}, "yarn.lock": "" })).pm).toBe("yarn");
    expect(detectPackageManager(repo({ "package.json": {} }))).toMatchObject({ pm: "npm", reason: "no lockfile (defaulting to npm)" });
  });

  it("warns about multiple lockfiles and a packageManager/lockfile mismatch", () => {
    const info = detectPackageManager(repo({ "package.json": { packageManager: "yarn@1.22.22" }, "package-lock.json": "{}", "pnpm-lock.yaml": "" }));
    expect(info.pm).toBe("yarn");
    expect(info.warnings.join(" ")).toMatch(/Multiple lockfiles[\s\S]*says yarn but the lockfile belongs to npm\/pnpm/);
  });

  it("rejects bun and Yarn Plug'n'Play with an explanation", () => {
    expect(() => detectPackageManager(repo({ "package.json": {}, "bun.lockb": "" }))).toThrow(/bun, which Codebase Doctor does not support/);
    expect(() => detectPackageManager(repo({ "package.json": {}, ".pnp.cjs": "", "yarn.lock": "" }))).toThrow(/Plug'n'Play/);
  });
});

describe("diagnoseInstallFailure", () => {
  it("names the blocking packages of an ERESOLVE peer conflict", () => {
    const out = [
      "npm ERR! code ERESOLVE",
      "npm ERR! Could not resolve dependency:",
      'npm ERR! peer react@"^0.14.0 || ^15.0.0-0 || ^16.0.0-0" from react-redux@5.1.2',
      'npm ERR! peer react@"<18.0.0" from @testing-library/react@12.1.5',
    ].join("\n");
    expect(diagnoseInstallFailure(out, "npm", "react", "18.3.1")).toBe(
      'Peer-dependency conflict: react-redux@5.1.2 (needs react@"^0.14.0 || ^15.0.0-0 || ^16.0.0-0"); ' +
        '@testing-library/react@12.1.5 (needs react@"<18.0.0"). Upgrade the blocking package on the migration branch ' +
        "(see the plan's peer-compatibility step), commit, and retry this step."
    );
  });

  it("recognises a missing package manager and network failures", () => {
    expect(diagnoseInstallFailure("'pnpm' is not recognized as an internal or external command", "pnpm", "react", "18")).toMatch(
      /`pnpm` does not appear to be installed/
    );
    expect(diagnoseInstallFailure("npm ERR! code ENOTFOUND\nnpm ERR! network request failed", "npm", "react", "18")).toMatch(
      /registry could not be reached/
    );
  });
});
