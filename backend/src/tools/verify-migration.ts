/**
 * Tool: verify_migration
 *
 * Skill-facing wrapper over run_checks. Runs the dependency check plus lint,
 * test and build, persists the result (checks-result.json, including the git
 * HEAD it ran on) and returns a diagnostic summary suitable for a subagent
 * fix loop. create_pull_request and generate_report read this persisted result.
 */

import { assertSession, readAnalysis, writeChecks, setPhase } from "../lib/session.js";
import { spawnChecks, formatChecks } from "./run-checks.js";

interface Input {
  sessionId: string;
}

export async function verifyMigration(input: Input): Promise<string> {
  const { sessionId } = input;

  assertSession(sessionId);
  const analysis = readAnalysis(sessionId);

  setPhase(sessionId, "checks_running");
  const result = await spawnChecks(sessionId, analysis, "all");
  writeChecks(sessionId, result);
  setPhase(sessionId, result.allPassed ? "checks_passed" : "implementing");

  const next = result.allPassed
    ? `Next step: call generate_report (format: html), then create_pull_request`
    : `Suggested next action: spawn a general subagent with fork_context:true to propose fixes for the failures above, then call verify_migration again.`;
  return `${formatChecks(result)}\n\n${next}`;
}
