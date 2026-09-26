import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findDependencyUsages, isTestFile } from "../../src/lib/ast.js";
import { resolveEcosystem } from "../../src/lib/ecosystem.js";
import { FIXTURE_SRC as FIXTURE_DIR, removeDir } from "../helpers.js";

const REACT_FAMILY = resolveEcosystem("react").packages;

const tmpDirs: string[] = [];
function tmpRepo(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cd-ast-"));
  tmpDirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}
afterAll(() => tmpDirs.forEach(removeDir));

describe("resolveEcosystem", () => {
  it("groups react and react-dom into one family", () => {
    expect(resolveEcosystem("react").packages).toEqual(["react", "react-dom"]);
    expect(resolveEcosystem("react-dom").id).toBe("react");
  });

  it("keeps unknown dependencies as a single-package family", () => {
    expect(resolveEcosystem("lodash").packages).toEqual(["lodash"]);
  });
});

describe("findDependencyUsages — React family import sites", () => {
  const usages = findDependencyUsages({ repoPath: FIXTURE_DIR, dependency: REACT_FAMILY });
  const imports = usages.filter((u) => u.kind === "import");

  it("finds react imports", () => {
    const reactImports = imports.filter((u) => u.module === "react");
    expect(new Set(reactImports.map((u) => u.file))).toEqual(
      new Set(["src/App.jsx", "src/App.test.jsx", "src/BatchedUpdatesExample.jsx", "src/StableComponent.tsx", "src/hydrate.jsx", "src/index.jsx"])
    );
  });

  it("finds react-dom imports", () => {
    const domImports = imports.filter((u) => u.module === "react-dom");
    expect(domImports.map((u) => u.file).sort()).toEqual(
      ["src/App.test.jsx", "src/BatchedUpdatesExample.jsx", "src/hydrate.jsx", "src/index.jsx"]
    );
  });

  it("finds react-dom/test-utils imports", () => {
    const tu = imports.filter((u) => u.module === "react-dom/test-utils");
    expect(tu).toHaveLength(1);
    expect(tu[0].file).toBe("src/App.test.jsx");
    expect(tu[0].line).toBe(2);
  });

  it("a single-package scan (dependency: 'react') does not include react-dom", () => {
    const onlyReact = findDependencyUsages({ repoPath: FIXTURE_DIR, dependency: "react" });
    expect(onlyReact.every((u) => u.module === "react")).toBe(true);
  });

  it("returns correct line numbers", () => {
    const indexImport = imports.find((u) => u.file === "src/index.jsx" && u.module === "react-dom");
    expect(indexImport!.line).toBe(2);
  });

  it("does not include node_modules", () => {
    for (const u of usages) expect(u.file).not.toMatch(/node_modules/);
  });
});

describe("findDependencyUsages — concrete API usages", () => {
  const usages = findDependencyUsages({ repoPath: FIXTURE_DIR, dependency: REACT_FAMILY });
  const api = (file: string, name: string) =>
    usages.filter((u) => u.kind === "api" && u.file === file && u.api === name);

  it("detects the ReactDOM.render call (not just the import) with file, line and arg count", () => {
    const [render] = api("src/index.jsx", "render");
    expect(render).toBeDefined();
    expect(render.module).toBe("react-dom");
    expect(render.line).toBe(5);
    expect(render.argCount).toBe(2);
    expect(render.importSpecifier).toBe("ReactDOM.render");
  });

  it("detects ReactDOM.hydrate", () => {
    const [hydrate] = api("src/hydrate.jsx", "hydrate");
    expect(hydrate.line).toBe(6);
    expect(hydrate.argCount).toBe(2);
  });

  it("detects ReactDOM.unstable_batchedUpdates", () => {
    expect(api("src/BatchedUpdatesExample.jsx", "unstable_batchedUpdates")).toHaveLength(1);
  });

  it("detects act as a named import from react-dom/test-utils and its call site", () => {
    const acts = api("src/App.test.jsx", "act");
    expect(acts.every((u) => u.module === "react-dom/test-utils")).toBe(true);
    expect(acts.map((u) => u.line).sort()).toEqual([2, 9]);
    expect(acts.find((u) => u.line === 9)!.argCount).toBe(1);
  });

  it("counts <React.StrictMode> once (opening tag only)", () => {
    const strict = api("src/index.jsx", "StrictMode");
    expect(strict).toHaveLength(1);
    expect(strict[0].module).toBe("react");
  });

  it("a namespace import alone is not recorded as an API usage", () => {
    // App.jsx imports React (default) but only uses the named useState import.
    expect(usages.filter((u) => u.file === "src/App.jsx" && u.kind === "api").map((u) => u.api)).toEqual(
      expect.arrayContaining(["useState"])
    );
    expect(api("src/App.jsx", "render")).toHaveLength(0);
  });

  it("handles named imports, aliases, three-argument calls and require()", () => {
    const dir = tmpRepo({
      "src/main.js": [
        "import { render as mount } from 'react-dom';",
        "mount(<App />, el, () => console.log('done'));",
      ].join("\n"),
      "src/legacy.js": [
        "const ReactDOM = require('react-dom');",
        "const { hydrate } = require('react-dom');",
        "ReactDOM.render(<App />, el);",
        "hydrate(<App />, el);",
      ].join("\n"),
    });
    const found = findDependencyUsages({ repoPath: dir, dependency: REACT_FAMILY });
    const mountCall = found.find((u) => u.file === "src/main.js" && u.api === "render" && u.argCount !== null);
    expect(mountCall!.argCount).toBe(3);
    expect(found.some((u) => u.file === "src/legacy.js" && u.api === "render" && u.argCount === 2)).toBe(true);
    expect(found.some((u) => u.file === "src/legacy.js" && u.api === "hydrate" && u.argCount === 2)).toBe(true);
  });

  it("scans .js/.jsx files even when a tsconfig.json without allowJs exists", () => {
    const dir = tmpRepo({
      "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true }, include: ["src/**/*.ts"] }),
      "src/index.jsx": "import ReactDOM from 'react-dom';\nReactDOM.render(<App />, root);\n",
    });
    const found = findDependencyUsages({ repoPath: dir, dependency: REACT_FAMILY });
    expect(found.some((u) => u.api === "render")).toBe(true);
  });

  it("restricts the scan to the given files", () => {
    const found = findDependencyUsages({ repoPath: FIXTURE_DIR, dependency: REACT_FAMILY, files: ["src/hydrate.jsx"] });
    expect(new Set(found.map((u) => u.file))).toEqual(new Set(["src/hydrate.jsx"]));
  });
});

describe("isTestFile", () => {
  it("recognises test files", () => {
    expect(isTestFile("src/App.test.jsx")).toBe(true);
    expect(isTestFile("src/foo.spec.ts")).toBe(true);
    expect(isTestFile("src/__tests__/foo.js")).toBe(true);
    expect(isTestFile("src/index.jsx")).toBe(false);
  });
});
