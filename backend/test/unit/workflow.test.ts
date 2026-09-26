/**
 * Tool-level workflow tests against disposable git copies of the fixture:
 * approval gate, honest step lifecycle, dependency install, restart
 * idempotency and report truthfulness. No network: installs use a fake runner.
 */

import { describe, it, expect, afterAll, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { readPlan, readRequirements, readSession, writeAnalysis, readAnalysis } from "../../src/lib/session.js";
import { setCommandRunner } from "../../src/lib/packages.js";
import { loadMigrationRequirements } from "../../src/tools/load-migration-requirements.js";
import { calculateMigrationBlastRadius } from "../../src/tools/calculate-migration-blast-radius.js";
import { generateMigrationPlan } from "../../src/tools/generate-migration-plan.js";
import { approveMigrationPlan } from "../../src/tools/approve-migration-plan.js";
import { checkoutBranch } from "../../src/tools/checkout-branch.js";
import { applyMigrationPatch } from "../../src/tools/apply-migration-patch.js";
import { verifyMigration } from "../../src/tools/verify-migration.js";
import { generateReport, buildReportData } from "../../src/tools/generate-report.js";
import { prepareWorkingCopy, seedSession, fakeInstaller, removeDir, sh } from "../helpers.js";

const copies: string[] = [];
afterAll(() => copies.forEach(removeDir));
afterEach(() => setCommandRunner(null));

async function planned(mutate?: (dir: string) => void) {
  const wc = prepareWorkingCopy(mutate);
  copies.push(wc);
  const sessionId = seedSession(wc);
  await loadMigrationRequirements({ sessionId });
  await calculateMigrationBlastRadius({ sessionId });
  await generateMigrationPlan({ sessionId });
  return { wc, sessionId };
}

async function approvedOnBranch(mutate?: (dir: string) => void) {
  const ctx = await planned(mutate);
  await approveMigrationPlan({ sessionId: ctx.sessionId, planId: readPlan(ctx.sessionId).planId, confirmation: "approved" });
  await checkoutBranch({ sessionId: ctx.sessionId });
  return ctx;
}

const stepFor = (sessionId: string, bcOrType: string) =>
  readPlan(sessionId).steps.find((s) => s.breakingChangeId === bcOrType || s.changeType === bcOrType)!;

const read = (wc: string, rel: string) => fs.readFileSync(path.join(wc, rel), "utf8");

// ---------------------------------------------------------------------------

describe("approval gate", () => {
  it("blocks checkout_branch and apply_migration_patch before approval", async () => {
    const { wc, sessionId } = await planned();
    const configStep = stepFor(sessionId, "config");

    await expect(checkoutBranch({ sessionId })).rejects.toThrow(/has not been approved/);
    await expect(applyMigrationPatch({ sessionId, stepId: configStep.id })).rejects.toThrow(/has not been approved/);

    expect(sh(wc, "git", ["branch", "--list"])).not.toContain("codebase-doctor/");
    expect(read(wc, "package.json")).toContain('"react": "^17.0.2"');
    expect(readPlan(sessionId).steps.every((s) => s.status === "pending")).toBe(true);
  });

  it("rejects a wrong planId or a confirmation other than 'approved'", async () => {
    const { sessionId } = await planned();
    const { planId } = readPlan(sessionId);
    await expect(approveMigrationPlan({ sessionId, planId: "stale-plan", confirmation: "approved" })).rejects.toThrow(/does not match/);
    await expect(approveMigrationPlan({ sessionId, planId, confirmation: "looks good but change step 3" })).rejects.toThrow(/must be the user's reply/);
    expect(readPlan(sessionId).approval.approved).toBe(false);
  });

  it("records approval idempotently and then allows modification", async () => {
    const { wc, sessionId } = await planned();
    const { planId } = readPlan(sessionId);

    const first = await approveMigrationPlan({ sessionId, planId, confirmation: " Approved " });
    expect(first).toContain("approved at");
    const approvedAt = readPlan(sessionId).approval.approvedAt;

    const second = await approveMigrationPlan({ sessionId, planId, confirmation: "approved" });
    expect(second).toContain("already approved");
    expect(readPlan(sessionId).approval.approvedAt).toBe(approvedAt);
    expect(readSession(sessionId).phase).toBe("plan_approved");

    await checkoutBranch({ sessionId });
    expect(sh(wc, "git", ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("codebase-doctor/react-18.3.1-upgrade");
  });

  it("refuses to apply when the migration branch is not checked out", async () => {
    const { sessionId } = await planned();
    await approveMigrationPlan({ sessionId, planId: readPlan(sessionId).planId, confirmation: "approved" });
    await expect(applyMigrationPatch({ sessionId, stepId: stepFor(sessionId, "react-bc-1").id })).rejects.toThrow(/call checkout_branch first/i);
  });
});

// ---------------------------------------------------------------------------

describe("restart idempotency", () => {
  it("generate_migration_plan returns the same plan (IDs, planId, approval) on re-call", async () => {
    const { sessionId } = await planned();
    const before = readPlan(sessionId);
    expect(before.steps.map((s) => s.id)).toEqual([
      "step-1-dependencies", "step-2-react-bc-1", "step-3-react-bc-2", "step-4-react-bc-3",
      "step-5-react-bc-4", "step-6-react-bc-6", "step-7-react-bc-7", "step-8-tests",
    ]);
    await approveMigrationPlan({ sessionId, planId: before.planId, confirmation: "approved" });

    const md = await generateMigrationPlan({ sessionId });
    expect(md).toContain("existing plan returned");
    const after = readPlan(sessionId);
    expect(after.planId).toBe(before.planId);
    expect(after.steps.map((s) => s.id)).toEqual(before.steps.map((s) => s.id));
    expect(after.approval.approved).toBe(true);
  });

  it("calculate_migration_blast_radius is repeatable without duplicating evidence", async () => {
    const { sessionId } = await planned();
    const first = readAnalysis(sessionId);
    await calculateMigrationBlastRadius({ sessionId });
    expect(readAnalysis(sessionId)).toEqual(first);
  });

  it("freezes requirements once the plan is approved", async () => {
    const { sessionId } = await planned();
    await approveMigrationPlan({ sessionId, planId: readPlan(sessionId).planId, confirmation: "approved" });
    await expect(loadMigrationRequirements({ sessionId })).resolves.toContain("react-bc-1"); // identical → no-op
    await expect(
      loadMigrationRequirements({ sessionId, docsText: "## Other Breaking Changes\n- something new\n" })
    ).rejects.toThrow(/already approved/);
  });

  it("checkout_branch twice keeps the original base commit", async () => {
    const { sessionId } = await approvedOnBranch();
    const base = readSession(sessionId).baseCommit;
    expect(base).toMatch(/^[0-9a-f]{40}$/);
    await checkoutBranch({ sessionId });
    expect(readSession(sessionId).baseCommit).toBe(base);
  });
});

// ---------------------------------------------------------------------------

describe("dependency step (config)", () => {
  it("upgrades react + react-dom together, installs, updates and commits the lockfile", async () => {
    const { wc, sessionId } = await approvedOnBranch();
    const fake = fakeInstaller();
    setCommandRunner(fake.runner);

    const out = await applyMigrationPatch({ sessionId, stepId: "step-1-dependencies" });
    expect(out).toContain("Status: applied");
    expect(fake.calls).toEqual([{ cmd: "npm", args: ["install"], cwd: wc }]);

    const pkg = JSON.parse(read(wc, "package.json"));
    expect(pkg.dependencies).toEqual({ react: "^18.3.1", "react-dom": "^18.3.1" });
    expect(pkg.devDependencies["@testing-library/react"]).toBe("^12.0.0"); // unrelated: untouched

    const committed = sh(wc, "git", ["show", "--name-only", "--format=", "HEAD"]).split("\n");
    expect(committed.sort()).toEqual(["package-lock.json", "package.json"]);
    expect(sh(wc, "git", ["show", "HEAD:package-lock.json"])).toContain('"version": "18.3.1"');

    const step = stepFor(sessionId, "config");
    expect(step.status).toBe("applied");
    expect(step.outcome!.installedVersions).toEqual({ react: "18.3.1", "react-dom": "18.3.1" });
  });

  it("restores package.json and stays pending when install fails", async () => {
    const { wc, sessionId } = await approvedOnBranch();
    setCommandRunner(fakeInstaller({ fail: true }).runner);
    await expect(applyMigrationPatch({ sessionId, stepId: "step-1-dependencies" })).rejects.toThrow(/restored[\s\S]*ERESOLVE/);
    expect(read(wc, "package.json")).toContain('"react": "^17.0.2"');
    expect(stepFor(sessionId, "config").status).toBe("pending");
  });

  it("rejects an install that leaves react and react-dom out of sync", async () => {
    const { sessionId } = await approvedOnBranch();
    setCommandRunner(fakeInstaller({ versions: { react: "18.3.1", "react-dom": "17.0.2" } }).runner);
    await expect(applyMigrationPatch({ sessionId, stepId: "step-1-dependencies" })).rejects.toThrow(/react-dom@17\.0\.2 does not satisfy/);
    expect(stepFor(sessionId, "config").status).toBe("pending");
  });

  it("cannot be marked complete manually", async () => {
    const { sessionId } = await approvedOnBranch();
    await expect(
      applyMigrationPatch({ sessionId, stepId: "step-1-dependencies", markManualComplete: true, note: "did it by hand" })
    ).rejects.toThrow(/cannot be marked complete manually/);
  });
});

// ---------------------------------------------------------------------------

describe("codemod steps", () => {
  it("bc-3 waits for the dependency step (needs react ≥ 18.3 installed)", async () => {
    const { sessionId } = await approvedOnBranch();
    await expect(applyMigrationPatch({ sessionId, stepId: stepFor(sessionId, "react-bc-3").id })).rejects.toThrow(/dependency step/);
    expect(stepFor(sessionId, "react-bc-3").status).toBe("pending");
  });

  it("marks automation with leftovers as manual_required, listing the residual usages", async () => {
    const { wc, sessionId } = await approvedOnBranch((dir) => {
      fs.writeFileSync(
        path.join(dir, "src", "legacy.jsx"),
        "import ReactDOM from 'react-dom';\nimport App from './App';\nReactDOM.render(<App />, el, () => console.log('done'));\n"
      );
    });
    const out = await applyMigrationPatch({ sessionId, stepId: stepFor(sessionId, "react-bc-1").id });
    const step = stepFor(sessionId, "react-bc-1");
    expect(step.status).toBe("manual_required");
    expect(step.outcome!.filesChanged).toEqual(["src/App.test.jsx", "src/index.jsx"]);
    expect(step.outcome!.residual).toEqual(["src/legacy.jsx:3 ReactDOM.render"]);
    expect(out).toContain("src/legacy.jsx:3");
    expect(read(wc, "src/legacy.jsx")).toContain("ReactDOM.render"); // unsafe 3-arg call left alone
  });
});

// ---------------------------------------------------------------------------

describe("manual and test steps are never falsely 'applied'", () => {
  it("a manual step makes no changes and becomes manual_required, not applied", async () => {
    const { wc, sessionId } = await approvedOnBranch();
    const head = sh(wc, "git", ["rev-parse", "HEAD"]);
    const stepId = stepFor(sessionId, "react-bc-7").id;

    const out = await applyMigrationPatch({ sessionId, stepId });
    expect(out).toContain("Status: manual_required");
    expect(out).toContain("no commit");
    expect(stepFor(sessionId, "react-bc-7").status).toBe("manual_required");
    expect(sh(wc, "git", ["rev-parse", "HEAD"])).toBe(head);
    expect(read(wc, "src/BatchedUpdatesExample.jsx")).toContain("unstable_batchedUpdates");

    expect(await applyMigrationPatch({ sessionId, stepId })).toContain("already processed");
  });

  it("completing a 'code' manual step requires a note and the pattern to be gone", async () => {
    const { wc, sessionId } = await approvedOnBranch();
    const stepId = stepFor(sessionId, "react-bc-7").id;
    await applyMigrationPatch({ sessionId, stepId });

    await expect(applyMigrationPatch({ sessionId, stepId, markManualComplete: true })).rejects.toThrow(/requires a `note`/);
    await expect(
      applyMigrationPatch({ sessionId, stepId, markManualComplete: true, note: "removed batching" })
    ).rejects.toThrow(/Still found 1 usage/);

    // Simulate the human/Bob edit
    const file = path.join(wc, "src/BatchedUpdatesExample.jsx");
    fs.writeFileSync(file, read(wc, "src/BatchedUpdatesExample.jsx").replace(/ReactDOM\.unstable_batchedUpdates\(\(\) => \{[\s\S]*?\}\);/, "// batched automatically in React 18"));

    const out = await applyMigrationPatch({ sessionId, stepId, markManualComplete: true, note: "Removed unstable_batchedUpdates wrapper" });
    const step = stepFor(sessionId, "react-bc-7");
    expect(step.status).toBe("completed_manual");
    expect(step.outcome!.filesChanged).toEqual(["src/BatchedUpdatesExample.jsx"]);
    expect(step.outcome!.note).toBe("Completed manually: Removed unstable_batchedUpdates wrapper");
    expect(out).toContain("Status: completed_manual");
  });

  it("'review' rules can be completed with a note while the API legitimately stays", async () => {
    const { sessionId } = await approvedOnBranch();
    const stepId = stepFor(sessionId, "react-bc-4").id;
    await applyMigrationPatch({ sessionId, stepId });
    await applyMigrationPatch({ sessionId, stepId, markManualComplete: true, note: "Audited setState in async callbacks — none depend on intermediate renders" });
    expect(stepFor(sessionId, "react-bc-4").status).toBe("completed_manual");
    expect(stepFor(sessionId, "react-bc-4").outcome!.commit).toBeNull(); // nothing to commit for a review
  });

  it("the test step claims no source modification", async () => {
    const { sessionId } = await approvedOnBranch();
    const out = await applyMigrationPatch({ sessionId, stepId: "step-8-tests" });
    const step = stepFor(sessionId, "test");
    expect(step.status).toBe("manual_required");
    expect(step.outcome!.filesChanged).toEqual([]);
    expect(step.outcome!.commit).toBeNull();
    expect(out).toContain("No automated test changes");
  });
});

// ---------------------------------------------------------------------------

describe("generate_report truthfulness", () => {
  it("before verification: no fabricated results, estimates labelled, Bobcoin not measured", async () => {
    const { sessionId } = await approvedOnBranch();
    const md = await generateReport({ sessionId, format: "markdown" });
    expect(md).toContain("Verification has not been run.");
    expect(md).toContain("| Test | NOT RUN |");
    expect(md).toContain("Estimated (not measured)");
    expect(md).toMatch(/Estimated manual effort \| ~\d+(\.\d)? h \| 6 affected files × 30 min\/file \(heuristic, not benchmarked\)/);
    expect(md).toContain("Bobcoin consumption — not measured");
    expect(md).toContain("Accuracy — not measured");
    expect(md).not.toMatch(/Breaking Changes Addressed/);
    expect(md).not.toContain("- [x]");
    expect(md).toContain("⏳ Not started");
  });

  it("reports each breaking change with its real step status and real check results", async () => {
    const { wc, sessionId } = await approvedOnBranch();
    setCommandRunner(fakeInstaller().runner);
    await applyMigrationPatch({ sessionId, stepId: "step-1-dependencies" });
    await applyMigrationPatch({ sessionId, stepId: stepFor(sessionId, "react-bc-1").id });
    await applyMigrationPatch({ sessionId, stepId: stepFor(sessionId, "react-bc-7").id });

    // No lint script in this repo → lint must be reported SKIPPED, not PASS.
    const analysis = readAnalysis(sessionId);
    writeAnalysis(sessionId, { ...analysis, lintCommand: null });
    await verifyMigration({ sessionId });

    const data = buildReportData(sessionId);
    expect(data.measured.checks!.allPassed).toBe(true);
    expect(data.measured.stepCounts).toMatchObject({ applied: 2, manual_required: 1, pending: 5 });
    expect(data.measured.filesChanged!.sort()).toEqual(["package-lock.json", "package.json", "src/App.test.jsx", "src/index.jsx"]);

    const md = await generateReport({ sessionId, format: "markdown" });
    const html = await generateReport({ sessionId, format: "html" });
    expect(md).toContain("| Lint | SKIPPED |");
    expect(md).toContain("| Test | PASS | npm run test |");
    expect(md).toContain("| Dependencies installed | PASS | react@18.3.1, react-dom@18.3.1 |");
    expect(md).toMatch(/✅ Automatically fixed \| HIGH \| `react-bc-1`/);
    expect(md).toMatch(/⚠️ Still requires manual action \| LOW \| `react-bc-7`/);
    expect(md).toMatch(/⏳ Not started \| HIGH \| `react-bc-2`/);
    expect(md).toContain("| Files changed on migration branch | 4 |");

    // HTML uses the same data
    expect(html).toContain('<td class="muted">SKIPPED</td>');
    expect(html).toContain("2/8");
    expect(html).toContain("⚠️ Still requires manual action");
    expect(html).toContain("Bobcoin consumption — not measured");
    expect(html).toContain("https://github.com/FayazNoor/Codebase-Doctor");
    expect(wc).toBeTruthy();
  });

  it("flags verification as stale when commits were added afterwards", async () => {
    const { sessionId } = await approvedOnBranch();
    setCommandRunner(fakeInstaller().runner);
    await applyMigrationPatch({ sessionId, stepId: "step-1-dependencies" });
    await verifyMigration({ sessionId });
    await applyMigrationPatch({ sessionId, stepId: stepFor(sessionId, "react-bc-1").id });
    expect(await generateReport({ sessionId, format: "markdown" })).toContain("STALE");
  });

  it("dependency check fails verification on stale node_modules", async () => {
    const { sessionId } = await approvedOnBranch();
    const out = await verifyMigration({ sessionId }); // dependency step not applied → nothing installed
    expect(out).toContain("Verification FAILED");
    expect(out).toContain("DEPENDENCY CHECK FAILED");
    expect(readRequirements(sessionId).breakingChanges.length).toBeGreaterThan(0);
  });
});
