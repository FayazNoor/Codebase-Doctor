/**
 * Detection and transform edge cases added during the final audit:
 * named react-dom imports (the form used in the official React 18 guide),
 * declaration names that are not references, type-position API usage,
 * the new detect-pattern fields and the new React 18 rules.
 */

import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { transformReactDOMRender, transformReactDOMHydrate } from "../../src/lib/transforms.js";
import { findDependencyUsages, scanDependencyUsages } from "../../src/lib/ast.js";
import { matchBreakingChanges } from "../../src/lib/risk.js";
import { loadKnowledgeFile } from "../../src/lib/requirements.js";
import { removeDir } from "../helpers.js";
import type { BreakingChange, DependencyUsage } from "../../src/types.js";

const dirs: string[] = [];
afterAll(() => dirs.forEach(removeDir));

function scan(files: Record<string, string>): DependencyUsage[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cd-detect-"));
  dirs.push(dir);
  for (const [rel, src] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), src);
  }
  return findDependencyUsages({ repoPath: dir, dependency: ["react", "react-dom"] });
}

const KB = loadKnowledgeFile("react-17-to-18.json");
const rules = (usages: DependencyUsage[]) => [...new Set(usages.flatMap((u) => matchBreakingChanges(u, KB)))].sort();

describe("named-import transforms (import { render } from 'react-dom')", () => {
  it("rewrites render(<App />, el) exactly like the official guide's example", () => {
    const src = [
      "import { render } from 'react-dom';",
      "import App from './App';",
      "const container = document.getElementById('app');",
      "render(<App tab=\"home\" />, container);",
      "",
    ].join("\n");
    expect(transformReactDOMRender(src)).toBe(
      [
        "import { createRoot } from 'react-dom/client';",
        "import App from './App';",
        "const container = document.getElementById('app');",
        "createRoot(container).render(<App tab=\"home\" />);",
        "",
      ].join("\n")
    );
  });

  it("keeps other react-dom named imports and supports aliases", () => {
    const src = "import { render as mount, createPortal } from \"react-dom\";\nmount(<A />, root);\nexport const p = createPortal;\n";
    const out = transformReactDOMRender(src);
    expect(out).toContain('import { createPortal } from "react-dom";');
    expect(out).toContain("import { createRoot } from 'react-dom/client';");
    expect(out).toContain("createRoot(root).render(<A />);");
    expect(out).not.toMatch(/\bmount\(/);
  });

  it("leaves a render callback (3 args) for the manual react-bc-5 step and is idempotent", () => {
    const src = "import { render } from 'react-dom';\nrender(<A />, el, () => done());\n";
    expect(transformReactDOMRender(src)).toBe(src);
    const migrated = transformReactDOMRender("import { render } from 'react-dom';\nrender(<A />, el);\n");
    expect(transformReactDOMRender(migrated)).toBe(migrated);
  });

  it("merges into an existing react-dom/client import", () => {
    const src = "import { hydrateRoot } from 'react-dom/client';\nimport { render } from 'react-dom';\nrender(<A />, el);\n";
    const out = transformReactDOMRender(src);
    expect(out).toContain("import { hydrateRoot, createRoot } from 'react-dom/client';");
    expect(out).not.toContain("from 'react-dom';");
  });

  it("multi-line JSX keeps the layout used in the React docs (not a dangling closing tag)", () => {
    const src = "import ReactDOM from 'react-dom';\nReactDOM.render(\n  <React.StrictMode>\n    <App />\n  </React.StrictMode>,\n  document.getElementById('root')\n);\n";
    expect(transformReactDOMRender(src)).toBe(
      "import { createRoot } from 'react-dom/client';\ncreateRoot(document.getElementById('root')).render(\n  <React.StrictMode>\n    <App />\n  </React.StrictMode>\n);\n"
    );
    const nested = "import ReactDOM from 'react-dom';\nfunction boot() {\n  ReactDOM.hydrate(\n    <App\n      data={x}\n    />,\n    el\n  );\n}\n";
    expect(transformReactDOMHydrate(nested)).toBe(
      "import { hydrateRoot } from 'react-dom/client';\nfunction boot() {\n  hydrateRoot(\n    el,\n    <App\n      data={x}\n    />\n  );\n}\n"
    );
  });

  it("rewrites named hydrate(<App />, el) → hydrateRoot(el, <App />)", () => {
    const out = transformReactDOMHydrate("import { hydrate } from 'react-dom';\nhydrate(<App />, document.getElementById('root'));\n");
    expect(out).toBe("import { hydrateRoot } from 'react-dom/client';\nhydrateRoot(document.getElementById('root'), <App />);\n");
  });

  it("a class component's render() method does not keep the import alive", () => {
    const src = [
      "import React from 'react';",
      "import { render } from 'react-dom';",
      "class App extends React.Component {",
      "  render() {",
      "    return <div />;",
      "  }",
      "}",
      "render(<App />, document.getElementById('root'));",
    ].join("\n");
    const out = transformReactDOMRender(src);
    expect(out).not.toContain("from 'react-dom';");
    expect(out).toContain("createRoot(document.getElementById('root')).render(<App />);");
    expect(out).toContain("  render() {");
  });
});

describe("AST scan", () => {
  it("does not treat declaration names (class render() method, JSX attribute, parameter) as API usages", () => {
    const usages = scan({
      "src/App.jsx": [
        "import React from 'react';",
        "import { render } from 'react-dom';",
        "class App extends React.Component { render() { return <List render={(render) => null} />; } }",
        "render(<App />, root);",
      ].join("\n"),
    });
    const renderApis = usages.filter((u) => u.kind === "api" && u.api === "render");
    // the named import binding (line 2) and the real call (line 4) — nothing on line 3
    expect(renderApis.map((u) => [u.line, u.argCount])).toEqual([
      [2, null],
      [4, 2],
    ]);
  });

  it("records type-position usage such as React.FC<Props> (for the @types/react 18 children rule)", () => {
    const usages = scan({
      "src/Card.tsx": "import React from 'react';\nexport const Card: React.FC<{ title: string }> = ({ title, children }) => <div>{title}{children}</div>;\n",
      "src/Named.tsx": "import { FC } from 'react';\nexport const N: FC = () => null;\n",
      "src/Plain.jsx": "import React from 'react';\nexport const P = React.FC;\n",
    });
    expect(rules(usages.filter((u) => u.file === "src/Card.tsx"))).toEqual(["react-bc-11"]);
    expect(rules(usages.filter((u) => u.file === "src/Named.tsx"))).toEqual(["react-bc-11"]);
    // extensions: [".ts", ".tsx"] — a .jsx file is not TypeScript evidence
    expect(rules(usages.filter((u) => u.file === "src/Plain.jsx"))).toEqual([]);
  });

  it("only parses files that mention the package family, and skips >1 MB bundles", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cd-scan-"));
    dirs.push(dir);
    fs.mkdirSync(path.join(dir, "src"));
    fs.writeFileSync(path.join(dir, "src", "a.js"), "import React from 'react';\n");
    fs.writeFileSync(path.join(dir, "src", "b.js"), "export const x = 1;\n");
    fs.writeFileSync(path.join(dir, "src", "bundle.js"), `import 'react';\n${"x".repeat(1_100_000)}`);
    const { usages, stats } = scanDependencyUsages({ repoPath: dir, dependency: ["react"] });
    expect(stats).toEqual({ filesScanned: 3, filesParsed: 1, filesTooLarge: 1 });
    expect(usages.map((u) => u.file)).toEqual(["src/a.js"]);
  });
});

describe("new React 18 rules from the official upgrade guide", () => {
  it("unmountComponentAtNode, unstable_renderSubtreeIntoContainer and renderToNodeStream are detected", () => {
    const usages = scan({
      "src/unmount.js": "import ReactDOM from 'react-dom';\nReactDOM.unmountComponentAtNode(el);\n",
      "src/subtree.js": "import { unstable_renderSubtreeIntoContainer } from 'react-dom';\nunstable_renderSubtreeIntoContainer(p, <A />, el);\n",
      "server/render.js": "import { renderToNodeStream } from 'react-dom/server';\nrenderToNodeStream(<A />).pipe(res);\n",
    });
    expect(rules(usages.filter((u) => u.file === "src/unmount.js"))).toEqual(["react-bc-8"]);
    expect(rules(usages.filter((u) => u.file === "src/subtree.js"))).toEqual(["react-bc-9"]);
    expect(rules(usages.filter((u) => u.file === "server/render.js"))).toEqual(["react-bc-10"]);
  });

  it("IS_REACT_ACT_ENVIRONMENT (react-bc-12) applies to tests that render with react-dom — not to app code", () => {
    const usages = scan({
      "src/index.jsx": "import { createRoot } from 'react-dom/client';\ncreateRoot(el).render(<A />);\n",
      "src/A.test.jsx": "import { createRoot } from 'react-dom/client';\ncreateRoot(div).render(<A />);\n",
    });
    expect(rules(usages.filter((u) => u.file === "src/index.jsx"))).toEqual([]);
    expect(rules(usages.filter((u) => u.file === "src/A.test.jsx"))).toEqual(["react-bc-12"]);
  });

  it("every rule is well-formed: unique IDs, detect patterns, docs keywords, and guidance for manual rules", () => {
    const ids = new Set<string>();
    for (const bc of [...KB, ...loadKnowledgeFile("express-4-to-5.json")] as BreakingChange[]) {
      expect(ids.has(bc.id)).toBe(false);
      ids.add(bc.id);
      expect(bc.detect?.length).toBeGreaterThan(0);
      expect(bc.docsKeywords?.length).toBeGreaterThan(0);
      if (!bc.automatable) expect(bc.manualAction).toBeTruthy();
    }
  });

  it("Express rules that affect every route file match the import itself ('*')", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cd-express-"));
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, "app.js"), "const express = require('express');\nconst app = express();\napp.use(express.urlencoded());\n");
    const usages = findDependencyUsages({ repoPath: dir, dependency: ["express"] });
    const express = loadKnowledgeFile("express-4-to-5.json");
    const hit = [...new Set(usages.flatMap((u) => matchBreakingChanges(u, express)))].sort();
    expect(hit).toEqual(["express-bc-1", "express-bc-2", "express-bc-3", "express-bc-5", "express-bc-6"]);
  });
});
