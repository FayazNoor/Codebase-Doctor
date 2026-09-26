/**
 * Risk scoring tests. Expected scores are EXACT and are the same reference
 * values documented (with their breakdown) in
 * .bob/skills/migration-doctor/severity-guide.md.
 */

import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { calculateBlastRadius, scoreFile, blastRadiusLabel, matchBreakingChanges } from "../../src/lib/risk.js";
import { findDependencyUsages } from "../../src/lib/ast.js";
import { resolveEcosystem } from "../../src/lib/ecosystem.js";
import { loadKnowledgeFile } from "../../src/lib/requirements.js";
import { FIXTURE_SRC, removeDir } from "../helpers.js";

const eco = resolveEcosystem("react");
const KB = loadKnowledgeFile("react-17-to-18.json");
const ctx = { bootstrapApis: eco.bootstrapApis };

function scoreSource(file: string, source: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cd-risk-"));
  tmp.push(dir);
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), source);
  const usages = findDependencyUsages({ repoPath: dir, dependency: eco.packages });
  return scoreFile(file, usages, KB, ctx);
}
const tmp: string[] = [];
afterAll(() => tmp.forEach(removeDir));

describe("fixture reference scores (severity-guide.md)", () => {
  const usages = findDependencyUsages({ repoPath: FIXTURE_SRC, dependency: eco.packages });
  const report = calculateBlastRadius(usages, KB, ctx);
  const score = (file: string) => report.topAffectedFiles.find((f) => f.file === file)?.riskScore ?? 0;

  it("entry file with ReactDOM.render + <React.StrictMode> = 80 (bc-1 40 + bc-6 10 + root bootstrap 30)", () => {
    expect(score("src/index.jsx")).toBe(80);
    expect(report.topAffectedFiles.find((f) => f.file === "src/index.jsx")!.reason).toBe(
      "react-bc-1 +40, react-bc-6 +10, root bootstrap +30"
    );
  });

  it("ReactDOM.hydrate(...) = 70 (bc-2 40 + root bootstrap 30)", () => {
    expect(score("src/hydrate.jsx")).toBe(70);
  });

  it("test file with act from react-dom/test-utils + ReactDOM.render = 80 (bc-1 40 + bc-3 20 + test harness 20)", () => {
    expect(score("src/App.test.jsx")).toBe(80);
  });

  it("unstable_batchedUpdates + useState = 30 (bc-4 20 + bc-7 10)", () => {
    expect(score("src/BatchedUpdatesExample.jsx")).toBe(30);
  });

  it("hooks-only component (useState/useEffect) = 20 (bc-4 automatic-batching review)", () => {
    expect(score("src/StableComponent.tsx")).toBe(20);
    expect(score("src/App.jsx")).toBe(20);
  });

  it("risk distribution follows the tiers (high ≥70, medium 40–69, low 1–39)", () => {
    expect(report.totalFiles).toBe(6);
    expect(report.affectedFiles).toBe(6);
    expect(report.riskDistribution).toEqual({ high: 3, medium: 0, low: 3 });
    expect(blastRadiusLabel(report)).toContain("Moderate");
  });

  it("topAffectedFiles are sorted by risk score descending", () => {
    const scores = report.topAffectedFiles.map((f) => f.riskScore);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it("is idempotent — rescoring does not duplicate breakingChangeIds", () => {
    const again = calculateBlastRadius(usages, KB, ctx);
    expect(again).toEqual(report);
    const render = usages.find((u) => u.file === "src/index.jsx" && u.api === "render")!;
    expect(render.breakingChangeIds).toEqual(["react-bc-1"]);
  });
});

describe("scoreFile — evidence, not imports", () => {
  it("importing ReactDOM without calling a changed API scores 0", () => {
    expect(scoreSource("src/util.js", "import ReactDOM from 'react-dom';\nexport const x = 1;\n").riskScore).toBe(0);
  });

  it("React imported only for JSX scores 0", () => {
    expect(scoreSource("src/Button.jsx", "import React from 'react';\nexport default () => <button />;\n").riskScore).toBe(0);
  });

  it("act from react-dom/test-utils in a test = 40 (bc-3 20 + test harness 20)", () => {
    const r = scoreSource(
      "src/Button.test.jsx",
      "import { act } from 'react-dom/test-utils';\nact(() => {});\n"
    );
    expect(r.riskScore).toBe(40);
    expect(r.breakingChangeIds).toEqual(["react-bc-3"]);
  });

  it("act imported from 'react' (already migrated) is not bc-3 evidence", () => {
    expect(scoreSource("src/B.test.jsx", "import { act } from 'react';\nact(() => {});\n").riskScore).toBe(0);
  });

  it("ReactDOM.render with a callback in an entry file = 90 (bc-1 40 + bc-5 20 + root bootstrap 30)", () => {
    const r = scoreSource(
      "src/index.js",
      "import ReactDOM from 'react-dom';\nReactDOM.render(<App />, root, () => {});\n"
    );
    expect(r.riskScore).toBe(90);
    expect(r.breakingChangeIds).toEqual(["react-bc-1", "react-bc-5"]);
  });

  it("clamps to 100", () => {
    const r = scoreSource(
      "src/index.js",
      [
        "import ReactDOM from 'react-dom';",
        "import React, { useState } from 'react';",
        "ReactDOM.render(<React.StrictMode><App /></React.StrictMode>, root, () => {});",
        "ReactDOM.hydrate(<App />, root);",
        "ReactDOM.unstable_batchedUpdates(() => {});",
      ].join("\n")
    );
    expect(r.riskScore).toBe(100);
  });
});

describe("matchBreakingChanges", () => {
  it("falls back to affectedApis for rules without detect patterns", () => {
    const usage = {
      file: "a.js", line: 1, column: 0, kind: "api" as const, module: "express", api: "json",
      argCount: 0, importSpecifier: "express.json", usageContext: "", riskScore: 0, breakingChangeIds: [],
    };
    const ids = matchBreakingChanges(usage, [
      { id: "x", description: "", affectedApis: ["json"], affectedFiles: [], automatable: false, codemods: [], severity: "low" },
    ]);
    expect(ids).toEqual(["x"]);
  });
});

describe("blastRadiusLabel", () => {
  it("returns minimal label when high count is 0", () => {
    const label = blastRadiusLabel({ totalFiles: 5, affectedFiles: 3, riskDistribution: { high: 0, medium: 2, low: 1 }, topAffectedFiles: [] });
    expect(label).toContain("Minimal");
  });

  it("returns large label when high count exceeds 20", () => {
    const label = blastRadiusLabel({ totalFiles: 50, affectedFiles: 40, riskDistribution: { high: 25, medium: 10, low: 5 }, topAffectedFiles: [] });
    expect(label).toContain("Large");
  });
});
