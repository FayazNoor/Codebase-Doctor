/**
 * create_pull_request gating + idempotency. GitHub API and git push are mocked.
 */

import { describe, it, expect, vi, afterAll, afterEach, beforeEach } from "vitest";

vi.mock("../../src/lib/github.js", () => ({
  findOpenPr: vi.fn(async () => null),
  createPr: vi.fn(async () => ({ url: "https://github.com/test/react17-fixture/pull/7", number: 7 })),
}));
vi.mock("../../src/lib/git.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/git.js")>()),
  pushBranch: vi.fn(),
}));

import { createPr, findOpenPr } from "../../src/lib/github.js";
import { pushBranch } from "../../src/lib/git.js";
import { readPlan, readSession, writeAnalysis, readAnalysis } from "../../src/lib/session.js";
import { setCommandRunner } from "../../src/lib/packages.js";
import { loadMigrationRequirements } from "../../src/tools/load-migration-requirements.js";
import { calculateMigrationBlastRadius } from "../../src/tools/calculate-migration-blast-radius.js";
import { generateMigrationPlan } from "../../src/tools/generate-migration-plan.js";
import { approveMigrationPlan } from "../../src/tools/approve-migration-plan.js";
import { checkoutBranch } from "../../src/tools/checkout-branch.js";
import { applyMigrationPatch } from "../../src/tools/apply-migration-patch.js";
import { verifyMigration } from "../../src/tools/verify-migration.js";
import { createPullRequest, buildPrBody } from "../../src/tools/create-pull-request.js";
import { prepareWorkingCopy, seedSession, fakeInstaller, removeDir } from "../helpers.js";

const copies: string[] = [];
afterAll(() => copies.forEach(removeDir));
beforeEach(() => vi.clearAllMocks());
afterEach(() => setCommandRunner(null));

async function planned() {
  const wc = prepareWorkingCopy();
  copies.push(wc);
  const sessionId = seedSession(wc);
  await loadMigrationRequirements({ sessionId });
  await calculateMigrationBlastRadius({ sessionId });
  await generateMigrationPlan({ sessionId });
  return sessionId;
}

/** Approve, checkout, and execute every step (manual ones end as manual_required). */
async function executed() {
  const sessionId = await planned();
  await approveMigrationPlan({ sessionId, planId: readPlan(sessionId).planId, confirmation: "approved" });
  await checkoutBranch({ sessionId });
  setCommandRunner(fakeInstaller().runner);
  for (const step of readPlan(sessionId).steps) await applyMigrationPatch({ sessionId, stepId: step.id });
  return sessionId;
}

describe("create_pull_request", () => {
  it("is blocked before plan approval", async () => {
    const sessionId = await planned();
    await expect(createPullRequest({ sessionId })).rejects.toThrow(/has not been approved/);
    expect(pushBranch).not.toHaveBeenCalled();
  });

  it("is blocked when verification has not run", async () => {
    const sessionId = await executed();
    await expect(createPullRequest({ sessionId })).rejects.toThrow(/Verification has not run/);
    expect(pushBranch).not.toHaveBeenCalled();
    expect(createPr).not.toHaveBeenCalled();
  });

  it("is blocked when the latest verification failed", async () => {
    const sessionId = await executed();
    writeAnalysis(sessionId, { ...readAnalysis(sessionId), testCommand: "node -e \"process.exit(1)\"" });
    await verifyMigration({ sessionId });
    await expect(createPullRequest({ sessionId })).rejects.toThrow(/FAILED — no PR opened/);
    expect(createPr).not.toHaveBeenCalled();
  });

  it("is blocked when commits were added after the passing verification", async () => {
    const sessionId = await executed();
    await verifyMigration({ sessionId });
    const { wc } = { wc: readSession(sessionId).repo.localPath };
    const fs = await import("node:fs");
    const file = `${wc}/src/BatchedUpdatesExample.jsx`;
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/ReactDOM\.unstable_batchedUpdates\(\(\) => \{[\s\S]*?\}\);/, ""));
    const bc7 = readPlan(sessionId).steps.find((s) => s.breakingChangeId === "react-bc-7")!;
    await applyMigrationPatch({ sessionId, stepId: bc7.id, markManualComplete: true, note: "removed wrapper" });
    await expect(createPullRequest({ sessionId })).rejects.toThrow(/Call verify_migration again/);
    expect(createPr).not.toHaveBeenCalled();
  });

  it("is blocked when steps were never executed", async () => {
    const sessionId = await planned();
    await approveMigrationPlan({ sessionId, planId: readPlan(sessionId).planId, confirmation: "approved" });
    await checkoutBranch({ sessionId });
    setCommandRunner(fakeInstaller().runner);
    await applyMigrationPatch({ sessionId, stepId: "step-1-dependencies" });
    await verifyMigration({ sessionId });
    await expect(createPullRequest({ sessionId })).rejects.toThrow(/never executed/);
  });

  it("opens the PR after a passing verification on HEAD, then is idempotent", async () => {
    const sessionId = await executed();
    const verify = await verifyMigration({ sessionId });
    expect(verify).toContain("Verification PASSED");

    const out = await createPullRequest({ sessionId });
    expect(out).toContain("https://github.com/test/react17-fixture/pull/7");
    expect(pushBranch).toHaveBeenCalledTimes(1);
    expect(createPr).toHaveBeenCalledTimes(1);
    const body = vi.mocked(createPr).mock.calls[0][0].body;
    expect(body).toContain("https://github.com/FayazNoor/Codebase-Doctor");
    expect(body).not.toContain("github.com/codebase-doctor/codebase-doctor");
    expect(body).toContain("still require manual action");
    expect(readSession(sessionId).pullRequest?.number).toBe(7);

    const again = await createPullRequest({ sessionId });
    expect(again).toContain("already opened");
    expect(createPr).toHaveBeenCalledTimes(1);
  });

  it("reuses an already-open PR for the branch instead of creating a duplicate", async () => {
    const sessionId = await executed();
    await verifyMigration({ sessionId });
    vi.mocked(findOpenPr).mockResolvedValueOnce({ url: "https://github.com/test/react17-fixture/pull/3", number: 3 });
    expect(await createPullRequest({ sessionId })).toContain("/pull/3");
    expect(createPr).not.toHaveBeenCalled();
    expect(pushBranch).not.toHaveBeenCalled();
  });
});

describe("buildPrBody", () => {
  it("links the real project repository", () => {
    expect(buildPrBody("s", "r", "react", "17", "18", 0)).toContain("(https://github.com/FayazNoor/Codebase-Doctor)");
  });
});
