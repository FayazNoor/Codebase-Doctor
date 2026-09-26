/**
 * Tool: checkout_branch
 *
 * Creates and switches to the migration branch in the cloned repository.
 * Requires an approved plan. Idempotent: if the branch already exists it is
 * checked out without being re-created, and the recorded base commit is kept.
 */

import { assertSession, assertPlanApproved, updateSession } from "../lib/session.js";
import { checkoutNewBranch, currentBranch, headCommit } from "../lib/git.js";

interface Input {
  sessionId: string;
}

export async function checkoutBranch(input: Input): Promise<string> {
  const { sessionId } = input;

  const session = assertSession(sessionId);
  const { localPath } = session.repo;
  const { migrationBranch } = session;

  if (!localPath) {
    throw new Error(
      "Repository has not been cloned yet. Call analyze_dependency_usage first."
    );
  }

  // Human-in-the-loop gate: no branch/source changes before approval.
  assertPlanApproved(sessionId);

  const base = headCommit(localPath);
  const created = checkoutNewBranch(localPath, migrationBranch);
  const actual = currentBranch(localPath);

  updateSession(sessionId, {
    phase: "implementing",
    // Record the base only once — on restart HEAD may already include migration commits.
    baseCommit: session.baseCommit ?? (created ? base ?? undefined : undefined),
  });

  return [
    `✅ ${created ? "Created and switched to" : "Switched to existing"} branch: ${actual}`,
    `Repository: ${localPath}`,
    `Next step: call apply_migration_patch with each stepId from the migration plan`,
  ].join("\n");
}
