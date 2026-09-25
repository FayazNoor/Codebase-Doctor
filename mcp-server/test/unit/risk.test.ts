import { describe, it, expect } from "vitest";
import {
  scoreUsage,
  calculateBlastRadius,
  blastRadiusLabel,
} from "../../src/lib/risk.js";
import type { DependencyUsage, BreakingChange } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Test data matching the fixture app and severity-guide.md reference scores
// ---------------------------------------------------------------------------

const REACT_18_BREAKING_CHANGES: BreakingChange[] = [
  {
    id: "react-bc-1",
    description: "ReactDOM.render() removed",
    affectedApis: ["ReactDOM", "render"],
    affectedFiles: [],
    automatable: true,
    codemods: [],
    severity: "high",
  },
  {
    id: "react-bc-3",
    description: "act() deprecated from react-dom/test-utils",
    affectedApis: ["act"],
    affectedFiles: [],
    automatable: true,
    codemods: [],
    severity: "medium",
  },
];

function makeUsage(overrides: Partial<DependencyUsage> = {}): DependencyUsage {
  return {
    file: "src/SomeComponent.tsx",
    line: 1,
    column: 0,
    importSpecifier: "React",
    usageContext: "import React from 'react'",
    riskScore: 0,
    breakingChangeIds: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// scoreUsage tests
// ---------------------------------------------------------------------------

describe("scoreUsage", () => {
  it("scores a ReactDOM.render usage at 85+ (matches severity-guide reference)", () => {
    const usage = makeUsage({
      file: "src/index.jsx",
      importSpecifier: "ReactDOM",
      usageContext: "ReactDOM.render(<App />, document.getElementById('root'))",
    });

    scoreUsage(usage, REACT_18_BREAKING_CHANGES, [usage]);

    // severity-guide.md: "File containing ReactDOM.render → expected score 85"
    expect(usage.riskScore).toBeGreaterThanOrEqual(80);
    expect(usage.riskScore).toBeLessThanOrEqual(100);
    expect(usage.breakingChangeIds).toContain("react-bc-1");
  });

  it("scores act() in a test file at 50–65 (matches severity-guide reference)", () => {
    const usage = makeUsage({
      file: "src/App.test.jsx",
      importSpecifier: "{ act }",
      usageContext: "import { act } from 'react-dom/test-utils'",
    });

    scoreUsage(usage, REACT_18_BREAKING_CHANGES, [usage]);

    // severity-guide.md: "act from react-dom/test-utils in a test → expected score 55"
    expect(usage.riskScore).toBeGreaterThanOrEqual(45);
    expect(usage.riskScore).toBeLessThanOrEqual(70);
    expect(usage.breakingChangeIds).toContain("react-bc-3");
  });

  it("scores a stable-only hooks component at 0–20 (matches severity-guide reference)", () => {
    const usage = makeUsage({
      file: "src/StableComponent.tsx",
      importSpecifier: "React, { useState, useEffect }",
      usageContext: "import React, { useState, useEffect } from 'react'",
    });

    scoreUsage(usage, REACT_18_BREAKING_CHANGES, [usage]);

    // severity-guide.md: "useState/useEffect only → expected score 15"
    expect(usage.riskScore).toBeGreaterThanOrEqual(0);
    expect(usage.riskScore).toBeLessThanOrEqual(25);
    expect(usage.breakingChangeIds).toHaveLength(0);
  });

  it("clamps score to 100 for extreme cases", () => {
    const usage = makeUsage({
      file: "src/index.tsx",
      importSpecifier: "ReactDOM, { useState, useEffect, useContext, useRef, useMemo }",
      usageContext: "ReactDOM.render(<App />, ...)",
    });

    scoreUsage(usage, REACT_18_BREAKING_CHANGES, [usage]);

    expect(usage.riskScore).toBeLessThanOrEqual(100);
  });

  it("scores never go negative", () => {
    const usage = makeUsage({
      file: "src/utils.test.ts",
      importSpecifier: "{ something }",
      usageContext: "import { something } from 'react'",
    });

    scoreUsage(usage, [], [usage]);

    expect(usage.riskScore).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// calculateBlastRadius tests
// ---------------------------------------------------------------------------

describe("calculateBlastRadius", () => {
  it("returns correct counts across risk tiers", () => {
    const usages: DependencyUsage[] = [
      makeUsage({ file: "src/index.jsx", importSpecifier: "ReactDOM", usageContext: "ReactDOM.render(...)" }),
      makeUsage({ file: "src/App.test.jsx", importSpecifier: "{ act }", usageContext: "import { act } from 'react-dom/test-utils'" }),
      makeUsage({ file: "src/StableComponent.tsx", importSpecifier: "React, { useState }", usageContext: "import React from 'react'" }),
    ];

    const report = calculateBlastRadius(usages, REACT_18_BREAKING_CHANGES);

    expect(report.totalFiles).toBe(3);
    expect(report.affectedFiles).toBeGreaterThanOrEqual(2);
    expect(report.riskDistribution.high).toBeGreaterThanOrEqual(1);
  });

  it("topAffectedFiles are sorted by risk score descending", () => {
    const usages: DependencyUsage[] = [
      makeUsage({ file: "src/index.jsx", importSpecifier: "ReactDOM", usageContext: "ReactDOM.render(...)" }),
      makeUsage({ file: "src/stable.tsx", importSpecifier: "React, { useState }", usageContext: "" }),
    ];

    const report = calculateBlastRadius(usages, REACT_18_BREAKING_CHANGES);

    expect(report.topAffectedFiles[0].riskScore).toBeGreaterThanOrEqual(
      report.topAffectedFiles[report.topAffectedFiles.length - 1].riskScore
    );
  });
});

// ---------------------------------------------------------------------------
// blastRadiusLabel tests
// ---------------------------------------------------------------------------

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
