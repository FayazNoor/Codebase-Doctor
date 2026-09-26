/**
 * Integration test: React 17 → 18 full pipeline
 *
 * Exercises the complete Codebase Doctor pipeline (every MCP tool except the
 * GitHub-backed analyze_dependency_usage clone and create_pull_request) against
 * a disposable git copy of the react17-app fixture:
 *
 *   1.  AST analysis of the React family (react + react-dom + subpaths)
 *   2.  load_migration_requirements WITH migration-guide docs text
 *   3.  calculate_migration_blast_radius
 *   4.  generate_migration_plan
 *   5.  approval gate (blocked) → approve_migration_plan
 *   6.  checkout_branch
 *   7.  apply_migration_patch for every step (install via fake runner — no network)
 *   8.  manual completion of manual/test steps with notes
 *   9.  verify_migration
 *   10. generate_report (markdown + html)
 *
 * Asserts actual changed source and honest statuses, not only exit codes.
 * Uses a temp CODEBASE_DOCTOR_HOME (test/setup.ts) and cleans up afterwards.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { readAnalysis, readRequirements, readPlan, readChecks, readSession } from "../../src/lib/session.js";
import { setCommandRunner } from "../../src/lib/packages.js";
import { loadMigrationRequirements } from "../../src/tools/load-migration-requirements.js";
import { calculateMigrationBlastRadius } from "../../src/tools/calculate-migration-blast-radius.js";
import { generateMigrationPlan } from "../../src/tools/generate-migration-plan.js";
import { approveMigrationPlan } from "../../src/tools/approve-migration-plan.js";
import { checkoutBranch } from "../../src/tools/checkout-branch.js";
import { applyMigrationPatch } from "../../src/tools/apply-migration-patch.js";
import { verifyMigration } from "../../src/tools/verify-migration.js";
import { generateReport } from "../../src/tools/generate-report.js";
import { prepareWorkingCopy, seedSession, fakeInstaller, removeDir, sh } from "../helpers.js";

const MIGRATION_GUIDE = `
# How to Upgrade to React 18
## Deprecated: render and hydrate
ReactDOM.render is no longer supported in React 18. Use createRoot instead. ReactDOM.hydrate → hydrateRoot.
## Automatic Batching
## Updates to Strict Mode
## Configuring Your Testing Environment
act from react-dom/test-utils is deprecated.
## Other Breaking Changes
- Consistent useEffect timing
`;

let workingCopy: string;
let sessionId: string;
const fake = fakeInstaller();

const read = (rel: string) => fs.readFileSync(path.join(workingCopy, rel), "utf8");
const step = (bc: string) => readPlan(sessionId).steps.find((s) => s.breakingChangeId === bc || s.changeType === bc)!;

beforeAll(() => {
  workingCopy = prepareWorkingCopy();
  sessionId = seedSession(workingCopy);
  setCommandRunner(fake.runner);
});

afterAll(() => {
  setCommandRunner(null);
  removeDir(workingCopy);
});

describe("1 — analysis covers the whole React family", () => {
  it("records react, react-dom and react-dom/test-utils usages with concrete APIs", () => {
    const usages = readAnalysis(sessionId).dependencyUsages;
    const modules = new Set(usages.map((u) => u.module));
    expect(modules).toEqual(new Set(["react", "react-dom", "react-dom/test-utils"]));
    const apis = new Set(usages.filter((u) => u.kind === "api").map((u) => `${u.module}:${u.api}`));
    for (const a of ["react-dom:render", "react-dom:hydrate", "react-dom:unstable_batchedUpdates", "react-dom/test-utils:act", "react:StrictMode"]) {
      expect(apis).toContain(a);
    }
  });
});

describe("2 — requirements with user docs keep canonical IDs", () => {
  it("loads canonical react-bc-* rules validated by the docs plus a manual docs-only rule", async () => {
    const out = await loadMigrationRequirements({ sessionId, docsText: MIGRATION_GUIDE });
    expect(out).toContain("react-17-to-18.json + supplied docs");
    const req = readRequirements(sessionId);
    expect(req.breakingChanges.map((b) => b.id)).toEqual([
      "react-bc-1", "react-bc-2", "react-bc-3", "react-bc-4", "react-bc-6", "react-bc-7", "docs-1",
    ]);
    expect(req.breakingChanges.find((b) => b.id === "docs-1")!.automatable).toBe(false);
  });
});

describe("3 — blast radius from real API evidence", () => {
  it("scores files per severity-guide.md", async () => {
    await calculateMigrationBlastRadius({ sessionId });
    const report = readAnalysis(sessionId).blastRadius!;
    const score = Object.fromEntries(report.topAffectedFiles.map((f) => [f.file, f.riskScore]));
    expect(score).toEqual({
      "src/index.jsx": 80,
      "src/App.test.jsx": 80,
      "src/hydrate.jsx": 70,
      "src/BatchedUpdatesExample.jsx": 30,
      "src/App.jsx": 20,
      "src/StableComponent.tsx": 20,
    });
  });
});

describe("4/5 — plan + approval gate", () => {
  it("generates a plan whose automated steps are exactly the canonical transforms", async () => {
    const md = await generateMigrationPlan({ sessionId });
    expect(md).toContain("NOT approved");
    const plan = readPlan(sessionId);
    expect(plan.steps.filter((s) => s.changeType === "codemod").map((s) => s.breakingChangeId)).toEqual([
      "react-bc-1", "react-bc-2", "react-bc-3",
    ]);
    expect(step("docs-1").changeType).toBe("manual");
    expect(step("react-bc-1").files).toEqual(["src/App.test.jsx", "src/index.jsx"]);
    expect(step("react-bc-2").files).toEqual(["src/hydrate.jsx"]);
    expect(step("react-bc-3").files).toEqual(["src/App.test.jsx"]);
  });

  it("blocks modification until approval is recorded", async () => {
    await expect(checkoutBranch({ sessionId })).rejects.toThrow(/not been approved/);
    await approveMigrationPlan({ sessionId, planId: readPlan(sessionId).planId, confirmation: "approved" });
    const out = await checkoutBranch({ sessionId });
    expect(out).toContain("codebase-doctor/react-18.3.1-upgrade");
  });
});

describe("7 — apply every step", () => {
  it("dependency step: react + react-dom upgraded, installed and lockfile committed", async () => {
    await applyMigrationPatch({ sessionId, stepId: step("config").id });
    expect(JSON.parse(read("package.json")).dependencies).toEqual({ react: "^18.3.1", "react-dom": "^18.3.1" });
    expect(fake.calls.map((c) => c.args.join(" "))).toEqual(["install"]);
    expect(step("config").status).toBe("applied");
  });

  it("react-bc-1: ReactDOM.render → createRoot in index.jsx and App.test.jsx", async () => {
    await applyMigrationPatch({ sessionId, stepId: step("react-bc-1").id });
    const index = read("src/index.jsx");
    expect(index).toContain("import { createRoot } from 'react-dom/client';");
    expect(index).toContain("createRoot(document.getElementById('root')).render(");
    expect(index).not.toContain("ReactDOM");
    expect(read("src/App.test.jsx")).toContain("createRoot(div).render(<App />)");
    expect(step("react-bc-1").status).toBe("applied");
  });

  it("react-bc-2: ReactDOM.hydrate → hydrateRoot (comment mentioning the old API is not a usage)", async () => {
    await applyMigrationPatch({ sessionId, stepId: step("react-bc-2").id });
    const src = read("src/hydrate.jsx");
    expect(src).toContain("hydrateRoot(document.getElementById('root'), <ServerApp />)");
    expect(src).not.toMatch(/ReactDOM\.hydrate\s*\(/);
    expect(src).not.toContain("import ReactDOM from 'react-dom'");
    expect(step("react-bc-2").status).toBe("applied");
  });

  it("react-bc-3: act import moved to 'react' (react 18.3.1 installed)", async () => {
    await applyMigrationPatch({ sessionId, stepId: step("react-bc-3").id });
    const src = read("src/App.test.jsx");
    expect(src).toContain("import { act } from 'react';");
    expect(src).not.toContain("react-dom/test-utils");
    expect(step("react-bc-3").status).toBe("applied");
  });

  it("manual rules and the test step are reported as manual_required, not applied", async () => {
    for (const id of ["react-bc-4", "react-bc-6", "react-bc-7", "docs-1", "test"]) {
      await applyMigrationPatch({ sessionId, stepId: step(id).id });
      expect(step(id).status).toBe("manual_required");
      expect(step(id).outcome!.commit).toBeNull();
    }
    expect(read("src/BatchedUpdatesExample.jsx")).toContain("unstable_batchedUpdates");
  });

  it("re-applying a processed step is a no-op", async () => {
    const head = sh(workingCopy, "git", ["rev-parse", "HEAD"]);
    expect(await applyMigrationPatch({ sessionId, stepId: step("react-bc-3").id })).toContain("already processed");
    expect(sh(workingCopy, "git", ["rev-parse", "HEAD"])).toBe(head);
  });
});

describe("8 — manual completion is explicit", () => {
  it("records reviewed/fixed manual steps with notes; one step is left open", async () => {
    await applyMigrationPatch({ sessionId, stepId: step("react-bc-4").id, markManualComplete: true, note: "Reviewed async setState — no intermediate-render assertions" });
    await applyMigrationPatch({ sessionId, stepId: step("react-bc-6").id, markManualComplete: true, note: "Effects have cleanups; double-invoke is safe" });
    await applyMigrationPatch({ sessionId, stepId: step("test").id, markManualComplete: true, note: "Tests updated by transforms; suite verified below" });
    expect(step("react-bc-4").status).toBe("completed_manual");
    expect(step("react-bc-7").status).toBe("manual_required"); // deliberately left open
  });
});

describe("9 — verify_migration", () => {
  it("passes against the new installed versions and records the verified commit", async () => {
    const out = await verifyMigration({ sessionId });
    expect(out).toContain("Verification PASSED");
    expect(out).toContain("react@18.3.1, react-dom@18.3.1");
    const checks = readChecks(sessionId);
    expect(checks.allPassed).toBe(true);
    expect(checks.headCommit).toBe(sh(workingCopy, "git", ["rev-parse", "HEAD"]));
    expect(readSession(sessionId).phase).toBe("checks_passed");
  });
});

describe("10 — generate_report", () => {
  it("markdown report reflects real statuses and measured values", async () => {
    const md = await generateReport({ sessionId, format: "markdown" });
    expect(md).toContain("✅ PASSED");
    expect(md).toContain("| Test | PASS | npm run test |");
    expect(md).toContain("| Steps automatically applied | 4 / 9 |");
    expect(md).toContain("| Steps manually fixed / reviewed | 3 |");
    expect(md).toContain("| Steps still requiring manual action | 2 |");
    expect(md).toMatch(/✅ Automatically fixed \| HIGH \| `react-bc-1`/);
    expect(md).toMatch(/✍️ Manually fixed \/ reviewed \| MEDIUM \| `react-bc-4`/);
    expect(md).toMatch(/⚠️ Still requires manual action \| LOW \| `react-bc-7`/);
    expect(md).toContain("| Files changed on migration branch | 5 |");
    expect(md).toContain("Bobcoin consumption — not measured");
  });

  it("HTML report is rendered from the same data", async () => {
    const html = await generateReport({ sessionId, format: "html" });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("4/9");
    expect(html).toContain('<td class="ok">PASS</td>');
    expect(html).toContain("Estimated (not measured)");
    expect(html).toContain("Made with IBM Bob");
  });
});
