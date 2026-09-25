/**
 * Tool: create_pull_request
 *
 * Pushes the migration branch to GitHub and opens a pull request
 * against the default branch. Returns the PR URL.
 */

import {
  assertSession,
  readPlan,
  readChecks,
  setPhase,
} from "../lib/session.js";
import { pushBranch } from "../lib/git.js";
import { createPr } from "../lib/github.js";
import { generateReport } from "./generate-report.js";

interface Input {
  sessionId: string;
}

export async function createPullRequest(input: Input): Promise<string> {
  const { sessionId } = input;

  const session = assertSession(sessionId);
  const plan = readPlan(sessionId);
  const { dependency, fromVersion, toVersion } = session.upgrade;

  // Generate the report for the PR body
  const reportMarkdown = await generateReport({ sessionId, format: "markdown" });

  // Push branch
  const token = process.env["GITHUB_TOKEN"];
  pushBranch(session.repo.localPath, session.migrationBranch, token);

  // Build PR title and body
  const title = `chore(deps): upgrade ${dependency} ${fromVersion} → ${toVersion} [Codebase Doctor]`;
  const body = buildPrBody(plan.summary, reportMarkdown, dependency, fromVersion, toVersion);

  // Open PR
  const prUrl = await createPr({
    owner: session.repo.owner,
    repo: session.repo.name,
    head: session.migrationBranch,
    base: session.repo.defaultBranch,
    title,
    body,
  });

  setPhase(sessionId, "pr_open");

  return [
    `🎉 Pull request opened!`,
    ``,
    `URL: ${prUrl}`,
    `Branch: ${session.migrationBranch} → ${session.repo.defaultBranch}`,
    `Title: ${title}`,
    ``,
    `Next step: call generate_report (format: html) to render the migration report artifact`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// PR body builder
// ---------------------------------------------------------------------------

function buildPrBody(
  summary: string,
  reportMarkdown: string,
  dep: string,
  from: string,
  to: string
): string {
  return [
    `## 🩺 Codebase Doctor — ${dep} ${from} → ${to}`,
    ``,
    `> This pull request was created automatically by [Codebase Doctor](https://github.com/codebase-doctor/codebase-doctor) using IBM Bob 2.0.`,
    ``,
    `### Summary`,
    summary,
    ``,
    `---`,
    ``,
    reportMarkdown,
  ].join("\n");
}
