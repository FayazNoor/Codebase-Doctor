/**
 * Tamper-evident session state and approval binding.
 *
 * Regression for the dry run in docs/bob-evidence/uzair/BOB_USAGE_LOG.md,
 * where a "reconstructed" checks-result.json was written by hand and the
 * report then showed "Verification PASSED".
 */

import { describe, it, expect, afterAll, afterEach, vi } from "vitest";

vi.mock("../../src/lib/github.js", () => ({
  findOpenPr: vi.fn(async () => null),
  createPr: vi.fn(async () => ({ url: "https://github.com/test/react17-fixture/pull/9", number: 9 })),
}));
vi.mock("../../src/lib/git.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/git.js")>()),
  pushBranch: vi.fn(),
}));

import fs from "node:fs";
import path from "node:path";
import { createPr } from "../../src/lib/github.js";
import { IntegrityError } from "../../src/lib/integrity.js";
import { readPlan, readChecks, sessionDir, writePlan, assertPlanApproved, readSession } from "../../src/lib/session.js";
import { setCommandRunner } from "../../src/lib/packages.js";
import { loadMigrationRequirements } from "../../src/tools/load-migration-requirements.js";
import { calculateMigrationBlastRadius } from "../../src/tools/calculate-migration-blast-radius.js";
import { generateMigrationPlan } from "../../src/tools/generate-migration-plan.js";
import { approveMigrationPlan } from "../../src/tools/approve-migration-plan.js";
import { checkoutBranch } from "../../src/tools/checkout-branch.js";
import { applyMigrationPatch } from "../../src/tools/apply-migration-patch.js";
import { verifyMigration } from "../../src/tools/verify-migration.js";
import { generateReport, buildReportData } from "../../src/tools/generate-report.js";
import { createPullRequest } from "../../src/tools/create-pull-request.js";
import { prepareWorkingCopy, seedSession, fakeInstaller, removeDir } from "../helpers.js";

const copies: string[] = [];
afterAll(() => copies.forEach(removeDir));
afterEach(() => setCommandRunner(null));

async function approvedSession() {
  const wc = prepareWorkingCopy();
  copies.push(wc);
  const sessionId = seedSession(wc);
  await loadMigrationRequirements({ sessionId });
  await calculateMigrationBlastRadius({ sessionId });
  await generateMigrationPlan({ sessionId });
  await approveMigrationPlan({ sessionId, planId: readPlan(sessionId).planId, confirmation: "approved" });
  await checkoutBranch({ sessionId });
  return sessionId;
}

const file = (sessionId: string, name: string) => path.join(sessionDir(sessionId), name);

describe("state files are sealed", () => {
  it("every state file carries a _seal that readers strip", async () => {
    const sessionId = await approvedSession();
    for (const name of ["session.json", "analysis.json", "requirements.json", "migration-plan.json"]) {
      expect(JSON.parse(fs.readFileSync(file(sessionId, name), "utf8"))._seal).toMatch(/^[0-9a-f]{64}$/);
    }
    expect((readPlan(sessionId) as unknown as Record<string, unknown>)._seal).toBeUndefined();
  });

  it("a hand-written ('reconstructed') checks-result.json is rejected everywhere", async () => {
    const sessionId = await approvedSession();
    setCommandRunner(fakeInstaller().runner);
    for (const step of readPlan(sessionId).steps) await applyMigrationPatch({ sessionId, stepId: step.id });

    // Exactly what the dry run did: write a passing result without running verify_migration.
    fs.writeFileSync(
      file(sessionId, "checks-result.json"),
      JSON.stringify({
        iteration: 1,
        timestamp: new Date().toISOString(),
        headCommit: readSession(sessionId).baseCommit,
        dependencies: { status: "passed", installed: { react: "18.3.1" }, output: "" },
        lint: { status: "skipped", command: null, output: "" },
        test: { status: "skipped", command: "npm run test", output: "", failedTests: [] },
        build: { status: "passed", command: "npm run build", output: "Build successful." },
        allPassed: true,
        failureSummary: null,
      })
    );

    expect(() => readChecks(sessionId)).toThrow(IntegrityError);
    await expect(createPullRequest({ sessionId })).rejects.toThrow(/Integrity check failed for checks-result\.json/);
    expect(createPr).not.toHaveBeenCalled();

    const data = buildReportData(sessionId);
    expect(data.measured.checks).toBeNull();
    expect(data.measured.checksProblem).toMatch(/Integrity check failed/);
    expect(data.headline.label).toBe("Verification untrusted");
    const md = await generateReport({ sessionId, format: "markdown" });
    expect(md).toContain("UNTRUSTED");
    expect(md).not.toContain("✅ PASSED");
    const html = await generateReport({ sessionId, format: "html" });
    expect(html).toContain("Stored verification result rejected");

    // Recovery: running the real tool replaces it with a sealed, genuine result.
    await verifyMigration({ sessionId });
    expect(readChecks(sessionId).allPassed).toBe(true);
  });

  it("editing a sealed checks result (flipping FAIL to PASS) is detected", async () => {
    const sessionId = await approvedSession();
    await verifyMigration({ sessionId }); // fails: dependency step not applied
    const raw = JSON.parse(fs.readFileSync(file(sessionId, "checks-result.json"), "utf8"));
    expect(raw.allPassed).toBe(false);
    raw.allPassed = true;
    fs.writeFileSync(file(sessionId, "checks-result.json"), JSON.stringify(raw));
    expect(() => readChecks(sessionId)).toThrow(/seal mismatch/);
  });

  it("flipping a step status in migration-plan.json by hand is detected", async () => {
    const sessionId = await approvedSession();
    const raw = JSON.parse(fs.readFileSync(file(sessionId, "migration-plan.json"), "utf8"));
    raw.steps[0].status = "applied";
    fs.writeFileSync(file(sessionId, "migration-plan.json"), JSON.stringify(raw));
    expect(() => readPlan(sessionId)).toThrow(IntegrityError);
    await expect(applyMigrationPatch({ sessionId, stepId: raw.steps[1].id })).rejects.toThrow(/Integrity check failed/);
  });

  it("corrupt JSON is reported as corrupted state, not a crash", async () => {
    const sessionId = await approvedSession();
    fs.writeFileSync(file(sessionId, "migration-plan.json"), "{ truncated");
    expect(() => readPlan(sessionId)).toThrow(/not valid JSON \(corrupted session state\)/);
  });
});

describe("approval is bound to the exact plan", () => {
  it("approval does not carry over to changed steps, even if planId was left untouched", async () => {
    const sessionId = await approvedSession();
    const plan = readPlan(sessionId);
    // A plan whose steps differ from what was approved (e.g. a step's files widened).
    plan.steps[1].files = [...plan.steps[1].files, "src/StableComponent.tsx"];
    writePlan(sessionId, plan);
    expect(() => assertPlanApproved(sessionId)).toThrow(/no longer matches its steps, so its approval is void/);
    await expect(applyMigrationPatch({ sessionId, stepId: plan.steps[1].id })).rejects.toThrow(/approval is void/);
  });

  it("session IDs that are not UUIDs never become paths", () => {
    expect(() => sessionDir("../../etc")).toThrow(/Invalid sessionId/);
  });
});
