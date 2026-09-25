import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findDependencyUsages } from "../../src/lib/ast.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(__dirname, "../fixtures/react17-app");

describe("findDependencyUsages", () => {
  it("finds all react import sites in the fixture app", () => {
    const usages = findDependencyUsages({
      repoPath: FIXTURE_DIR,
      dependency: "react",
    });

    // Should find imports in index.jsx, App.jsx, App.test.jsx, StableComponent.tsx
    expect(usages.length).toBeGreaterThanOrEqual(4);
    const files = new Set(usages.map((u) => u.file));
    expect(files.size).toBeGreaterThanOrEqual(4);
  });

  it("finds react-dom imports separately from react imports", () => {
    const usages = findDependencyUsages({
      repoPath: FIXTURE_DIR,
      dependency: "react-dom",
    });

    // index.jsx and App.test.jsx both import from react-dom
    expect(usages.length).toBeGreaterThanOrEqual(2);
    const files = usages.map((u) => u.file);
    expect(files.some((f) => f.includes("index"))).toBe(true);
    expect(files.some((f) => f.includes("test"))).toBe(true);
  });

  it("detects react-dom/test-utils subpath imports", () => {
    const usages = findDependencyUsages({
      repoPath: FIXTURE_DIR,
      dependency: "react-dom",
    });

    const testUtilsUsage = usages.find((u) =>
      u.importSpecifier.includes("act") || u.usageContext.includes("test-utils")
    );
    expect(testUtilsUsage).toBeDefined();
  });

  it("returns correct line numbers", () => {
    const usages = findDependencyUsages({
      repoPath: FIXTURE_DIR,
      dependency: "react-dom",
    });

    const indexUsage = usages.find((u) => u.file.includes("index"));
    expect(indexUsage).toBeDefined();
    expect(indexUsage!.line).toBe(2); // line 2 of index.jsx
  });

  it("does not include node_modules", () => {
    const usages = findDependencyUsages({
      repoPath: FIXTURE_DIR,
      dependency: "react",
    });

    for (const u of usages) {
      expect(u.file).not.toMatch(/node_modules/);
    }
  });
});
