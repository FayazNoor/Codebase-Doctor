/**
 * Tool: verify_migration
 *
 * Skill-facing wrapper over run_checks. Runs lint + test + build and
 * returns a structured result with a diagnostic summary suitable for
 * a subagent fix loop.
 */

import { assertSession, readAnalysis, writeChecks } from "../lib/session.js";
import { spawnChecks } from "./run-checks.js";
import type { ChecksResult } from "../types.js";

interface Input {
  sessionId: string;
}

export async function verifyMigration(input: Input): Promise<string> {
  const { sessionId } = input;

  assertSession(sessionId);
  const analysis = readAnalysis(sessionId);

  const result = await spawnChecks(sessionId, analysis, "all");
  writeChecks(sessionId, result);

  return formatVerificationResult(result);
}

function formatVerificationResult(result: ChecksResult): string {
  const icon = result.allPassed ? "✅" : "❌";
  const lines = [
    `${icon} Verification ${result.allPassed ? "PASSED" : "FAILED"} (iteration ${result.iteration})`,
    ``,
    `Lint:  ${result.lint.passed ? "✅ passed" : "❌ failed"}`,
    `Test:  ${result.test.passed ? "✅ passed" : `❌ failed (${result.test.failedTests.length} tests)`}`,
    `Build: ${result.build.passed ? "✅ passed" : "❌ failed"}`,
  ];

  if (!result.allPassed && result.failureSummary) {
    lines.push(``);
    lines.push(`**Failure diagnosis for fix loop:**`);
    lines.push(result.failureSummary);
  }

  if (!result.allPassed) {
    lines.push(``);
    lines.push(`Suggested next action: spawn a general subagent with fork_context:true to propose fixes for the failures above, then call verify_migration again.`);
  } else {
    lines.push(``);
    lines.push(`Next step: call generate_report then create_pull_request`);
  }

  return lines.join("\n");
}
