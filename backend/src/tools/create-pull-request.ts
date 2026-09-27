/**
 * Tool: create_pull_request
 *
 * Pushes the migration branch to GitHub and opens a pull request against the
 * default branch. Returns the PR URL.
 *
 * Refuses unless: the repository has a GitHub remote, the plan is approved,
 * no step is un-started or failed, verify_migration has run, its latest result
 * passed, it ran on the current HEAD with a clean working tree, and the tree
 * is still clean (uncommitted edits would be verified but not pushed).
 * Idempotent: a PR already recorded for the session (or already open on
 * GitHub for the branch) is returned instead of opening a duplicate.
 */

import {
  assertSession,
  assertPlanApproved,
  readChecksIfExists,
  updateSession,
} from "../lib/session.js";
import { pushBranch, headCommit, uncommittedFiles } from "../lib/git.js";
import { createPr, findOpenPr } from "../lib/github.js";
import { projectUrl } from "../lib/project.js";
import { generateReport } from "./generate-report.js";

interface Input {
  sessionId: string;
}

/** GitHub rejects PR bodies above 65,536 characters. */
export const MAX_PR_BODY = 60_000;

export async function createPullRequest(input: Input): Promise<string> {
  const { sessionId } = input;

  const session = assertSession(sessionId);
  const plan = assertPlanApproved(sessionId);
  const { dependency, fromVersion, toVersion } = session.upgrade;
  const { owner, name, localPath, defaultBranch } = session.repo;

  if (session.pullRequest) {
    return `ℹ️ Pull request already opened for this session: ${session.pullRequest.url}`;
  }
  if (!owner) {
    throw new Error(
      `This session analysed a local repository without a GitHub remote, so no pull request can be opened. ` +
        `The verified branch '${session.migrationBranch}' is in ${localPath} — push it from there.`
    );
  }

  // --- Plan execution gate (a failure is the root cause, so it is reported first) ---
  const failed = plan.steps.filter((s) => s.status === "failed");
  if (failed.length > 0) {
    throw new Error(
      `${failed.length} plan step(s) failed: ${failed.map((s) => s.id).join(", ")}. Retry them with apply_migration_patch ` +
        `(or skip non-dependency steps with a reason) before opening a PR.`
    );
  }
  const notStarted = plan.steps.filter((s) => s.status === "pending");
  if (notStarted.length > 0) {
    throw new Error(
      `${notStarted.length} plan step(s) were never executed: ${notStarted.map((s) => s.id).join(", ")}. ` +
        `Run apply_migration_patch for each (manual steps are then reported honestly as requiring action).`
    );
  }

  // --- Verification gate ------------------------------------------------------
  const checks = readChecksIfExists(sessionId);
  if (!checks) {
    throw new Error("Verification has not run. Call verify_migration and get a passing result before opening a PR.");
  }
  if (!checks.allPassed) {
    throw new Error(
      `Latest verification (iteration ${checks.iteration}) FAILED — no PR opened. ` +
        `Fix the failures, then call verify_migration again.\n${(checks.failureSummary ?? "").slice(0, 300)}`
    );
  }
  const head = headCommit(localPath);
  if (checks.headCommit !== head) {
    throw new Error(
      `Verification ran on ${checks.headCommit?.slice(0, 7) ?? "unknown"} but HEAD is now ${head?.slice(0, 7) ?? "unknown"}. ` +
        `Call verify_migration again so the PR reflects the verified code.`
    );
  }
  if ((checks.uncommittedFiles ?? []).length > 0) {
    throw new Error(
      `The passing verification ran with uncommitted changes (${checks.uncommittedFiles!.slice(0, 5).join(", ")}), so it did not verify ` +
        `the commit that would be pushed. Commit them (apply_migration_patch with markManualComplete + note), then verify_migration again.`
    );
  }
  const dirtyNow = uncommittedFiles(localPath);
  if (dirtyNow.length > 0) {
    throw new Error(
      `The working tree has uncommitted changes (${dirtyNow.slice(0, 5).join(", ")}) that would not be part of the PR. ` +
        `Commit them through apply_migration_patch (markManualComplete + note) and verify again, or discard them.`
    );
  }

  // --- Idempotency: reuse an open PR for this branch ---------------------------
  const existing = await findOpenPr(owner, name, session.migrationBranch, defaultBranch);
  if (existing) {
    updateSession(sessionId, { pullRequest: { ...existing, createdAt: new Date().toISOString() }, phase: "pr_open" });
    return `ℹ️ An open pull request already exists for ${session.migrationBranch}: ${existing.url}`;
  }

  // Generate the report for the PR body (from the same persisted data as the HTML report)
  const reportMarkdown = await generateReport({ sessionId, format: "markdown", forPullRequest: true });

  // Push branch (never forced; auth/permission errors carry a hint)
  pushBranch(localPath, session.migrationBranch, process.env["GITHUB_TOKEN"]);

  const open = plan.steps.filter((s) => s.status === "manual_required" || s.status === "skipped").length;
  const title = `chore(deps): upgrade ${dependency} ${fromVersion} → ${toVersion} [Codebase Doctor]`;
  const body = buildPrBody(plan.summary, reportMarkdown, dependency, fromVersion, toVersion, open);

  let pr;
  try {
    pr = await createPr({ owner, repo: name, head: session.migrationBranch, base: defaultBranch, title, body });
  } catch (err) {
    throw new Error(
      `${(err as Error).message}\nThe branch '${session.migrationBranch}' was pushed; calling create_pull_request again is safe (it will not push a duplicate or open a second PR).`
    );
  }
  updateSession(sessionId, { pullRequest: { ...pr, createdAt: new Date().toISOString() }, phase: "pr_open" });

  return [
    `🎉 Pull request opened!`,
    ``,
    `URL: ${pr.url}`,
    `Branch: ${session.migrationBranch} → ${defaultBranch}`,
    open > 0 ? `⚠️ ${open} step(s) still need a human (listed in the PR body).` : "",
    ``,
    `Next step: call generate_report (format: html) again so the report artifact shows the PR link`,
  ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");
}

// ---------------------------------------------------------------------------
// PR body builder
// ---------------------------------------------------------------------------

export function buildPrBody(
  summary: string,
  reportMarkdown: string,
  dep: string,
  from: string,
  to: string,
  openSteps: number
): string {
  const header = [
    `## 🩺 Codebase Doctor — ${dep} ${from} → ${to}`,
    ``,
    `> This pull request was created by [Codebase Doctor](${projectUrl()}) using IBM Bob. ` +
      `Every plan step was approved by a human first, and the dependency check plus lint/test/build ` +
      `(whichever the repository defines) passed on the pushed commit before it was opened.`,
    ``,
    `### Summary`,
    summary,
    openSteps > 0 ? `\n⚠️ **${openSteps} step(s) still require manual action** — see "Remaining work" below.` : "",
    ``,
    `---`,
    ``,
  ].join("\n");
  const room = MAX_PR_BODY - header.length;
  const report =
    reportMarkdown.length <= room
      ? reportMarkdown
      : `${reportMarkdown.slice(0, room - 200)}\n\n… _(report truncated to fit GitHub's PR body limit — the full HTML report is in the Bob session)_`;
  return header + report;
}
