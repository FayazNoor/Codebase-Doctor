/**
 * Step lifecycle, recovery and gating added in the final audit:
 * skipped / failed states, rollback when a commit is rejected, the
 * peer-compatibility step, dirty-tree verification, local repositories,
 * the stage-aware report and get_session_status. No network.
 */

import { describe, it, expect, afterAll, afterEach, beforeEach, vi } from "vitest";

vi.mock("../../src/lib/github.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/github.js")>()),
  getRepoInfo: vi.fn(async () => {
    throw Object.assign(new Error("offline in tests"), { status: null });
  }),
  findOpenPr: vi.fn(async () => null),
  createPr: vi.fn(async () => ({ url: "https://github.com/test/react17-fixture/pull/11", number: 11 })),
}));
vi.mock("../../src/lib/git.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/git.js")>()),
  pushBranch: vi.fn(),
}));

import fs from "node:fs";
import path from "node:path";
import { createPr } from "../../src/lib/github.js";
import { readPlan, readSession, readAnalysis, listSessions, sessionDir, writeAnalysis } from "../../src/lib/session.js";
import { setCommandRunner } from "../../src/lib/packages.js";
import { setRegistryFetcher } from "../../src/lib/compat.js";
import { analyzeDependencyUsage } from "../../src/tools/analyze-dependency-usage.js";
import { loadMigrationRequirements } from "../../src/tools/load-migration-requirements.js";
import { calculateMigrationBlastRadius } from "../../src/tools/calculate-migration-blast-radius.js";
import { generateMigrationPlan } from "../../src/tools/generate-migration-plan.js";
import { approveMigrationPlan } from "../../src/tools/approve-migration-plan.js";
import { checkoutBranch } from "../../src/tools/checkout-branch.js";
import { applyMigrationPatch } from "../../src/tools/apply-migration-patch.js";
import { verifyMigration } from "../../src/tools/verify-migration.js";
import { generateReport, buildReportData, trimDiff, mdCell } from "../../src/tools/generate-report.js";
import { createPullRequest, buildPrBody, MAX_PR_BODY } from "../../src/tools/create-pull-request.js";
import { getSessionStatus } from "../../src/tools/get-session-status.js";
import { clip } from "../../src/tools/run-checks.js";
import { prepareWorkingCopy, seedSession, fakeInstaller, removeDir, sh } from "../helpers.js";

const copies: string[] = [];
afterAll(() => copies.forEach(removeDir));
afterEach(() => setCommandRunner(null));
beforeEach(() => vi.clearAllMocks());

const read = (wc: string, rel: string) => fs.readFileSync(path.join(wc, rel), "utf8");
const stepFor = (sessionId: string, key: string) =>
  readPlan(sessionId).steps.find((s) => s.breakingChangeId === key || s.changeType === key || s.id.endsWith(key))!;

async function onBranch(mutate?: (dir: string) => void) {
  const wc = prepareWorkingCopy(mutate);
  copies.push(wc);
  const sessionId = seedSession(wc);
  await loadMigrationRequirements({ sessionId });
  await calculateMigrationBlastRadius({ sessionId });
  await generateMigrationPlan({ sessionId });
  await approveMigrationPlan({ sessionId, planId: readPlan(sessionId).planId, confirmation: "approved" });
  await checkoutBranch({ sessionId });
  return { wc, sessionId };
}

async function allExecuted() {
  const ctx = await onBranch();
  setCommandRunner(fakeInstaller().runner);
  for (const step of readPlan(ctx.sessionId).steps) await applyMigrationPatch({ sessionId: ctx.sessionId, stepId: step.id });
  return ctx;
}

// ---------------------------------------------------------------------------

describe("skipped steps", () => {
  it("need a reason, stay visible as open work, and do not block the PR", async () => {
    const { sessionId } = await allExecuted();
    const id = stepFor(sessionId, "react-bc-7").id;
    await expect(applyMigrationPatch({ sessionId, stepId: id, skip: true })).rejects.toThrow(/skip requires a `note`/);
    const out = await applyMigrationPatch({ sessionId, stepId: id, skip: true, note: "Batching wrapper kept until the analytics refactor" });
    expect(out).toContain("Status: skipped");
    expect(stepFor(sessionId, "react-bc-7").outcome!.note).toBe("Skipped by user: Batching wrapper kept until the analytics refactor");
    expect(stepFor(sessionId, "react-bc-7").outcome!.attempts).toBe(1); // skipping is not another attempt

    const data = buildReportData(sessionId);
    expect(data.measured.stepCounts.skipped).toBe(1);
    expect(data.remaining.map((r) => [r.id, r.status])).toContainEqual([id, "skipped"]);

    await verifyMigration({ sessionId });
    await createPullRequest({ sessionId });
    const body = vi.mocked(createPr).mock.calls[0][0].body;
    expect(body).toContain("⏭️ Skipped by user (still open)");
    expect(body).not.toContain("**Status:**"); // the PR is the status — no "open the pull request" line inside it
    expect(body).toContain("Batching wrapper kept until the analytics refactor");
  });

  it("an applied step cannot be skipped", async () => {
    const { sessionId } = await allExecuted();
    await expect(
      applyMigrationPatch({ sessionId, stepId: stepFor(sessionId, "react-bc-1").id, skip: true, note: "changed my mind" })
    ).rejects.toThrow(/already 'applied'; there is nothing to skip/);
  });
});

describe("failed steps", () => {
  it("a codemod whose commit is rejected (pre-commit hook) is rolled back and recorded as failed — never 'already migrated'", async () => {
    const { wc, sessionId } = await onBranch();
    const hook = path.join(wc, ".git", "hooks", "pre-commit");
    fs.writeFileSync(hook, "#!/bin/sh\necho 'lint-staged: 2 errors' >&2\nexit 1\n");
    fs.chmodSync(hook, 0o755);
    const id = stepFor(sessionId, "react-bc-2").id;

    await expect(applyMigrationPatch({ sessionId, stepId: id })).rejects.toThrow(/FAILED[\s\S]*commit was rejected[\s\S]*lint-staged: 2 errors/);
    expect(read(wc, "src/hydrate.jsx")).toContain("ReactDOM.hydrate("); // restored, not left transformed
    expect(sh(wc, "git", ["status", "--porcelain", "--untracked-files=no"])).toBe("");
    expect(stepFor(sessionId, "react-bc-2").status).toBe("failed");

    // Before the fix, a retry found nothing to transform and reported success.
    fs.rmSync(hook);
    const out = await applyMigrationPatch({ sessionId, stepId: id });
    expect(out).toContain("Status: applied");
    expect(read(wc, "src/hydrate.jsx")).toContain("hydrateRoot(");
  });

  it("failed steps block the pull request", async () => {
    const { sessionId } = await onBranch();
    setCommandRunner(fakeInstaller({ fail: true }).runner);
    await expect(applyMigrationPatch({ sessionId, stepId: stepFor(sessionId, "config").id })).rejects.toThrow(/FAILED/);
    setCommandRunner(fakeInstaller().runner);
    for (const s of readPlan(sessionId).steps.filter((x) => x.status === "pending")) {
      await applyMigrationPatch({ sessionId, stepId: s.id }).catch(() => undefined);
    }
    await expect(createPullRequest({ sessionId })).rejects.toThrow(/plan step\(s\) failed: step-1-dependencies/);
    expect(buildReportData(sessionId).headline).toEqual({ label: "Step failed", tone: "bad" });
  });
});

describe("peer-compatibility step", () => {
  it("unresolvable conflicts become a manual step that must be handled before the install runs", async () => {
    const { wc, sessionId } = await (async () => {
      const wc = prepareWorkingCopy();
      copies.push(wc);
      const sessionId = seedSession(wc);
      const analysis = readAnalysis(sessionId);
      writeAnalysis(sessionId, {
        ...analysis,
        compat: {
          checked: true,
          method: "test",
          packagesChecked: 3,
          note: null,
          conflicts: [
            { name: "react-redux", version: "5.1.2", section: "dependencies", peer: "react", range: "^16", source: "lockfile", suggestion: "^7.2.9", autoUpgrade: false },
            { name: "@testing-library/react", version: "^12.0.0", section: "devDependencies", peer: "react", range: "< 13.0.0", source: "known", suggestion: "^14.3.1", autoUpgrade: true },
          ],
        },
      });
      await loadMigrationRequirements({ sessionId });
      await calculateMigrationBlastRadius({ sessionId });
      await generateMigrationPlan({ sessionId });
      return { wc, sessionId };
    })();

    const plan = readPlan(sessionId);
    expect(plan.steps.slice(0, 2).map((s) => s.id)).toEqual(["step-1-peer-compat", "step-2-dependencies"]);
    expect(plan.steps[0].description).toContain("`react-redux@5.1.2` (peer react ^16) → try `^7.2.9`");
    expect(plan.steps[1].packageChanges!.map((c) => `${c.name}@${c.to} (${c.reason})`)).toEqual([
      "react@^18.3.1 (target)",
      "react-dom@^18.3.1 (companion)",
      "@testing-library/react@^14.3.1 (peer-compat)",
    ]);

    await approveMigrationPlan({ sessionId, planId: plan.planId, confirmation: "approved" });
    await checkoutBranch({ sessionId });
    setCommandRunner(fakeInstaller().runner);
    await expect(applyMigrationPatch({ sessionId, stepId: "step-2-dependencies" })).rejects.toThrow(/Resolve the peer-dependency conflicts first/);

    await applyMigrationPatch({ sessionId, stepId: "step-1-peer-compat" });
    const pkgPath = path.join(wc, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    pkg.dependencies["react-redux"] = "^7.2.9";
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    await applyMigrationPatch({ sessionId, stepId: "step-1-peer-compat", markManualComplete: true, note: "react-redux 5 → 7.2.9 (connect API unchanged)" });

    const out = await applyMigrationPatch({ sessionId, stepId: "step-2-dependencies" });
    expect(out).toContain("Status: applied");
    const after = JSON.parse(read(wc, "package.json"));
    expect(after.dependencies).toMatchObject({ react: "^18.3.1", "react-dom": "^18.3.1", "react-redux": "^7.2.9" });
    expect(after.devDependencies["@testing-library/react"]).toBe("^14.3.1");
  });
});

describe("install failure after skipping the peer step", () => {
  it("names the library the preflight flagged, even when npm blames another package", async () => {
    const wc = prepareWorkingCopy();
    copies.push(wc);
    const sessionId = seedSession(wc);
    writeAnalysis(sessionId, {
      ...readAnalysis(sessionId),
      compat: {
        checked: true, method: "test", packagesChecked: 3, note: null,
        conflicts: [
          { name: "react-redux", version: "7.2.6", section: "dependencies", peer: "react", range: "^16.8.3 || ^17", source: "lockfile", suggestion: "^7.2.7", autoUpgrade: false },
        ],
      },
    });
    await loadMigrationRequirements({ sessionId });
    await calculateMigrationBlastRadius({ sessionId });
    await generateMigrationPlan({ sessionId });
    await approveMigrationPlan({ sessionId, planId: readPlan(sessionId).planId, confirmation: "approved" });
    await checkoutBranch({ sessionId });
    await applyMigrationPatch({ sessionId, stepId: "step-1-peer-compat" });
    await applyMigrationPatch({ sessionId, stepId: "step-1-peer-compat", skip: true, note: "react-redux should work with React 18" });

    // The fake npm output blames @testing-library/react — like the real run did.
    setCommandRunner(fakeInstaller({ fail: true }).runner);
    await expect(applyMigrationPatch({ sessionId, stepId: "step-2-dependencies" })).rejects.toThrow(
      /The preflight flagged `react-redux@7\.2\.6` \(peer react \^16\.8\.3 \|\| \^17; try `\^7\.2\.7`\) and step 'step-1-peer-compat' was skipped — that is the likely blocker/
    );
    expect(stepFor(sessionId, "config").status).toBe("failed");
  });
});

describe("verification must describe the pushed commit", () => {
  it("a passing verification on a dirty working tree cannot open a PR", async () => {
    const { wc, sessionId } = await allExecuted();
    fs.appendFileSync(path.join(wc, "src/App.jsx"), "\n// fix made while debugging, never committed\n");
    const out = await verifyMigration({ sessionId });
    expect(out).toContain("Verification PASSED");
    expect(out).toContain("Ran on uncommitted changes (src/App.jsx)");
    await expect(createPullRequest({ sessionId })).rejects.toThrow(/ran with uncommitted changes \(src\/App\.jsx\)/);
    expect(buildReportData(sessionId).headline.label).toBe("Uncommitted changes");

    // Committing through the tool and verifying again unblocks it.
    await applyMigrationPatch({ sessionId, stepId: stepFor(sessionId, "test").id, markManualComplete: true, note: "Kept the debugging comment on purpose" });
    await verifyMigration({ sessionId });
    await expect(createPullRequest({ sessionId })).resolves.toContain("/pull/11");
  });

  it("uncommitted edits made AFTER a clean verification also block the PR", async () => {
    const { wc, sessionId } = await allExecuted();
    await verifyMigration({ sessionId });
    fs.appendFileSync(path.join(wc, "src/App.jsx"), "\n// late edit\n");
    await expect(createPullRequest({ sessionId })).rejects.toThrow(/working tree has uncommitted changes \(src\/App\.jsx\)/);
    expect(createPr).not.toHaveBeenCalled();
  });
});

describe("verification history", () => {
  it("keeps every run of the fix loop instead of only the latest", async () => {
    const { sessionId } = await onBranch();
    await verifyMigration({ sessionId }); // nothing installed yet → fails
    setCommandRunner(fakeInstaller().runner);
    for (const step of readPlan(sessionId).steps) await applyMigrationPatch({ sessionId, stepId: step.id });
    await verifyMigration({ sessionId });

    const history = buildReportData(sessionId).measured.history;
    expect(history.map((h) => [h.iteration, h.allPassed, h.statuses.dependencies])).toEqual([
      [1, false, "failed"],
      [2, true, "passed"],
    ]);
    expect(await generateReport({ sessionId, format: "markdown" })).toMatch(/Verification history: #1 failed on `[0-9a-f]{7}` → #2 passed on `[0-9a-f]{7}`/);
    expect(await generateReport({ sessionId, format: "html" })).toContain('aria-label="Verification history"');
  });
});

describe("PR body", () => {
  it("is capped below GitHub's 65,536-character limit", () => {
    const body = buildPrBody("summary", "x".repeat(200_000), "react", "17", "18", 0);
    expect(body.length).toBeLessThanOrEqual(MAX_PR_BODY);
    expect(body).toContain("report truncated to fit GitHub's PR body limit");
  });

  it("escapes table cells: pipes, raw HTML and @-mentions from docs text", () => {
    expect(mdCell("a | b\n<img src=x onerror=alert(1)> @everyone")).toBe("a \\| b &lt;img src=x onerror=alert(1)&gt; @​everyone");
  });
});

describe("local repositories", () => {
  it("analyze_dependency_usage clones a local repo (never touching it), checks peers offline, and refuses a PR", async () => {
    const src = prepareWorkingCopy();
    copies.push(src);
    const before = sh(src, "git", ["status", "--porcelain"]);

    const out = await analyzeDependencyUsage({ url: src, dependency: "react", targetVersion: "^18.3.1" });
    const sessionId = out.match(/Session created: ([0-9a-f-]{36})/)![1];
    expect(out).toContain("branch codebase-doctor/react-18.3.1-upgrade");
    expect(out).toContain("Local repository without a GitHub remote");
    expect(out).toContain("@testing-library/react@^12.0.0");

    const session = readSession(sessionId);
    expect(session.repo).toMatchObject({ source: "local", owner: "", defaultBranch: "main" });
    expect(session.repo.localPath).not.toBe(src);
    expect(sh(src, "git", ["status", "--porcelain"])).toBe(before);
    const analysis = readAnalysis(sessionId);
    expect(analysis.filesScanned).toBe(6);
    expect(analysis.compat!.conflicts.map((c) => c.name)).toEqual(["@testing-library/react"]);

    await loadMigrationRequirements({ sessionId });
    await calculateMigrationBlastRadius({ sessionId });
    await generateMigrationPlan({ sessionId });
    await approveMigrationPlan({ sessionId, planId: readPlan(sessionId).planId, confirmation: "approved" });
    await expect(createPullRequest({ sessionId })).rejects.toThrow(/local repository without a GitHub remote/);
  });

  it("errors leave no half-created session behind", async () => {
    const noPkg = prepareWorkingCopy((dir) => fs.rmSync(path.join(dir, "package.json")));
    const noDep = prepareWorkingCopy((dir) => {
      const p = path.join(dir, "package.json");
      const pkg = JSON.parse(fs.readFileSync(p, "utf8"));
      delete pkg.dependencies.react;
      pkg.peerDependencies = { react: ">=16" };
      fs.writeFileSync(p, JSON.stringify(pkg));
    });
    const bun = prepareWorkingCopy((dir) => fs.writeFileSync(path.join(dir, "bun.lockb"), ""));
    copies.push(noPkg, noDep, bun);
    const count = () => (fs.existsSync(path.join(sessionDir("00000000-0000-0000-0000-000000000000"), "..")) ? fs.readdirSync(path.join(sessionDir("00000000-0000-0000-0000-000000000000"), "..")).length : 0);
    const n = count();

    await expect(analyzeDependencyUsage({ url: noPkg, dependency: "react", targetVersion: "18" })).rejects.toThrow(/No package.json at the repository root/);
    await expect(analyzeDependencyUsage({ url: noDep, dependency: "react", targetVersion: "18" })).rejects.toThrow(/not declared[\s\S]*only a peerDependency: >=16/);
    await expect(analyzeDependencyUsage({ url: bun, dependency: "react", targetVersion: "18" })).rejects.toThrow(/bun/);
    await expect(analyzeDependencyUsage({ url: noPkg, dependency: "react", targetVersion: "16" })).rejects.toThrow(/No package.json/);
    const ok = prepareWorkingCopy();
    copies.push(ok);
    await expect(analyzeDependencyUsage({ url: ok, dependency: "react", targetVersion: "16" })).rejects.toThrow(/Downgrades are not supported/);
    await expect(analyzeDependencyUsage({ url: noPkg, dependency: "react", targetVersion: "latest" })).rejects.toThrow(/not supported/);

    // A target that was never published fails at analysis, not later as a confusing install error.
    delete process.env["CODEBASE_DOCTOR_OFFLINE"];
    setRegistryFetcher(async (name) => (name === "react" ? { versions: { "17.0.2": {}, "18.3.1": {} } } : null));
    try {
      await expect(analyzeDependencyUsage({ url: ok, dependency: "react", targetVersion: "18.99.0" })).rejects.toThrow(
        /No published version of react matches 18\.99\.0 \(newest in that major: 18\.3\.1\)/
      );
    } finally {
      setRegistryFetcher(null);
      process.env["CODEBASE_DOCTOR_OFFLINE"] = "1";
    }
    expect(count()).toBe(n);
  });
});

describe("stage-aware report and status", () => {
  it("renders right after analysis with honest empty states", async () => {
    const wc = prepareWorkingCopy();
    copies.push(wc);
    const sessionId = seedSession(wc);
    const data = buildReportData(sessionId);
    expect(data.headline.label).toBe("Analysed");
    expect(data.stages.map((s) => s.state)).toEqual(["done", "current", "todo", "todo", "todo", "todo", "todo", "todo"]);
    const html = await generateReport({ sessionId, format: "html" });
    expect(html).toContain("Rules have not been loaded yet.");
    expect(html).toContain("Verification has not run yet.");
    expect(html).toContain("Nothing has been changed");
    expect(html).not.toMatch(/Verification passed/);
  });

  it("the plan section says approval is pending and nothing is changed before it", async () => {
    const wc = prepareWorkingCopy();
    copies.push(wc);
    const sessionId = seedSession(wc);
    await loadMigrationRequirements({ sessionId });
    await calculateMigrationBlastRadius({ sessionId });
    await generateMigrationPlan({ sessionId });
    const data = buildReportData(sessionId);
    expect(data.headline).toEqual({ label: "Awaiting approval", tone: "warn" });
    expect(data.stages[4].state).toBe("current");
    const html = await generateReport({ sessionId, format: "html" });
    expect(html).toContain("awaiting approval</strong>");
  });

  it("HTML never renders repository content unescaped", async () => {
    const wc = prepareWorkingCopy((dir) =>
      fs.writeFileSync(path.join(dir, "src", "evil.jsx"), "import React from 'react';\nexport const E = () => React.createElement('b'); // </code><script>alert(1)</script>\n")
    );
    copies.push(wc);
    const sessionId = seedSession(wc);
    expect(readAnalysis(sessionId).dependencyUsages.some((u) => u.usageContext.includes("<script>alert(1)</script>"))).toBe(true);
    const html = await generateReport({ sessionId, format: "html" });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("get_session_status lists sessions and names the next action", async () => {
    const { sessionId } = await onBranch();
    expect(listSessions(50).map((s) => s.id)).toContain(sessionId);
    expect(await getSessionStatus({})).toContain(sessionId);
    const status = await getSessionStatus({ sessionId });
    expect(status).toContain("Plan ");
    expect(status).toContain("⏳ step-1-dependencies — pending");
    expect(status).toContain('Next: apply_migration_patch { stepId: "step-1-dependencies" }');
  });

  it("changes section shows per-step diffs with lockfiles summarised", async () => {
    const { sessionId } = await allExecuted();
    const data = buildReportData(sessionId);
    const dep = data.changes.find((c) => c.title.startsWith("Update react"))!;
    expect(dep.diff).toMatch(/lockfile diff omitted: \+\d+ −\d+ lines/);
    const bc1 = data.changes.find((c) => c.title.startsWith("ReactDOM.render"))!;
    expect(bc1.diff).toContain("+import { createRoot } from 'react-dom/client';");
    expect(trimDiff("diff --git a/x b/x\n" + "+a\n".repeat(1000)).truncated).toBe(true);
  });

  it("clip keeps both the start and the end of long command output", () => {
    const text = "FIRST ERROR\n" + "x".repeat(10_000) + "\nTests: 1 failed, 3 passed";
    const out = clip(text);
    expect(out.startsWith("FIRST ERROR")).toBe(true);
    expect(out.endsWith("Tests: 1 failed, 3 passed")).toBe(true);
    expect(out).toMatch(/characters omitted/);
  });
});
