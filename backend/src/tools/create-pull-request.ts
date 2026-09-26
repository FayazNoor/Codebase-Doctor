/**
 * Tool: create_pull_request
 *
 * Pushes the migration branch to GitHub and opens a pull request against the
 * default branch. Returns the PR URL.
 *
 * Refuses unless: the plan is approved, verify_migration has run, its latest
 * result passed, it ran on the current HEAD, and no plan step is still
 * un-started. Idempotent: a PR already recorded for the session (or already
 * open on GitHub for the branch) is returned instead of opening a duplicate.
 */

import {
  assertSession,
  assertPlanApproved,
  readChecksIfExists,
  updateSession,
} from "../lib/session.js";
import { pushBranch, headCommit } from "../lib/git.js";
import { createPr, findOpenPr } from "../lib/github.js";
import { projectUrl } from "../lib/project.js";
import { generateReport } from "./generate-report.js";

interface Input {
  sessionId: string;
}

export async function createPullRequest(input: Input): Promise<string> {
  const { sessionId } = input;

  const session = assertSession(sessionId);
  const plan = assertPlanApproved(sessionId);
  const { dependency, fromVersion, toVersion } = session.upgrade;
  const { owner, name, localPath, defaultBranch } = session.repo;

  if (session.pullRequest) {
    return `ℹ️ Pull request already opened for this session: ${session.pullRequest.url}`;
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
  const notStarted = plan.steps.filter((s) => s.status === "pending");
  if (notStarted.length > 0) {
    throw new Error(
      `${notStarted.length} plan step(s) were never executed: ${notStarted.map((s) => s.id).join(", ")}. ` +
        `Run apply_migration_patch for each (manual steps are then reported honestly as requiring action).`
    );
  }

  // --- Idempotency: reuse an open PR for this branch ---------------------------
  const existing = await findOpenPr(owner, name, session.migrationBranch, defaultBranch);
  if (existing) {
    updateSession(sessionId, { pullRequest: { ...existing, createdAt: new Date().toISOString() }, phase: "pr_open" });
    return `ℹ️ An open pull request already exists for ${session.migrationBranch}: ${existing.url}`;
  }

  // Generate the report for the PR body (from the same persisted data as the HTML report)
  const reportMarkdown = await generateReport({ sessionId, format: "markdown" });

  // Push branch
  pushBranch(localPath, session.migrationBranch, process.env["GITHUB_TOKEN"]);

  const manualLeft = plan.steps.filter((s) => s.status === "manual_required").length;
  const title = `chore(deps): upgrade ${dependency} ${fromVersion} → ${toVersion} [Codebase Doctor]`;
  const body = buildPrBody(plan.summary, reportMarkdown, dependency, fromVersion, toVersion, manualLeft);

  const pr = await createPr({ owner, repo: name, head: session.migrationBranch, base: defaultBranch, title, body });
  updateSession(sessionId, { pullRequest: { ...pr, createdAt: new Date().toISOString() }, phase: "pr_open" });

  return [
    `🎉 Pull request opened!`,
    ``,
    `URL: ${pr.url}`,
    `Branch: ${session.migrationBranch} → ${defaultBranch}`,
    manualLeft > 0 ? `⚠️ ${manualLeft} step(s) still require manual action (listed in the PR body).` : "",
    ``,
    `Next step: call generate_report (format: html) to render the migration report artifact`,
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
  manualLeft: number
): string {
  return [
    `## 🩺 Codebase Doctor — ${dep} ${from} → ${to}`,
    ``,
    `> This pull request was created by [Codebase Doctor](${projectUrl()}) using IBM Bob. ` +
      `Lint/test/build passed on the pushed commit before it was opened.`,
    ``,
    `### Summary`,
    summary,
    manualLeft > 0 ? `\n⚠️ **${manualLeft} step(s) still require manual action** — see "Breaking Changes" below.` : "",
    ``,
    `---`,
    ``,
    reportMarkdown,
  ].join("\n");
}
