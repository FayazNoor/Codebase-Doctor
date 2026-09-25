/**
 * Tool: checkout_branch
 *
 * Creates and switches to the migration branch in the cloned repository.
 * Idempotent: safe to call again if the branch already exists.
 */

import { assertSession, updateSession } from "../lib/session.js";
import { checkoutNewBranch, currentBranch } from "../lib/git.js";

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

  checkoutNewBranch(localPath, migrationBranch);
  const actual = currentBranch(localPath);

  updateSession(sessionId, { phase: "implementing" });

  return [
    `✅ Switched to branch: ${actual}`,
    `Repository: ${localPath}`,
    `Next step: call apply_migration_patch with each stepId from the migration plan`,
  ].join("\n");
}
