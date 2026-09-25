/**
 * Tool: run_checks (internal)
 *
 * Spawns lint, test, and/or build commands in the repository's local clone.
 * verify_migration is the skill-facing wrapper; use run_checks directly for
 * low-level debugging only.
 */

import { execSync } from "node:child_process";
import { assertSession, readAnalysis } from "../lib/session.js";
import type { AnalysisResult, ChecksResult, CheckResult } from "../types.js";

interface Input {
  sessionId: string;
  command: "lint" | "test" | "build" | "all";
}

export async function runChecks(input: Input): Promise<string> {
  const { sessionId, command } = input;

  assertSession(sessionId);
  const analysis = readAnalysis(sessionId);

  const result = await spawnChecks(sessionId, analysis, command);

  return JSON.stringify(result, null, 2);
}

// ---------------------------------------------------------------------------
// Core execution (exported for verify_migration)
// ---------------------------------------------------------------------------

export async function spawnChecks(
  sessionId: string,
  analysis: AnalysisResult,
  command: "lint" | "test" | "build" | "all"
): Promise<ChecksResult> {
  const session = (await import("../lib/session.js")).readSession(sessionId);
  const cwd = session.repo.localPath;

  let iteration = 1;
  try {
    const prev = (await import("../lib/session.js")).readChecks(sessionId);
    iteration = prev.iteration + 1;
  } catch {
    // First run
  }

  const lint: CheckResult & { failedTests?: string[] } = runCommand(
    analysis.lintCommand ?? "echo 'no lint command'",
    cwd,
    command === "all" || command === "lint"
  );

  const testRaw = runCommand(
    analysis.testCommand ?? "echo 'no test command'",
    cwd,
    command === "all" || command === "test"
  );

  const build = runCommand(
    analysis.buildCommand ?? "echo 'no build command'",
    cwd,
    command === "all" || command === "build"
  );

  const failedTests = extractFailedTests(testRaw.output);
  const test = { ...testRaw, failedTests };

  const allPassed = lint.passed && test.passed && build.passed;

  const failureSummary = allPassed ? null : buildFailureSummary(lint, test, build);

  return {
    iteration,
    timestamp: new Date().toISOString(),
    lint,
    test,
    build,
    allPassed,
    failureSummary,
  };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function runCommand(
  cmd: string,
  cwd: string,
  shouldRun: boolean
): CheckResult {
  if (!shouldRun || cmd.startsWith("echo")) {
    return { passed: true, output: "(skipped)" };
  }

  try {
    const output = execSync(cmd, {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120_000, // 2 minute timeout per command
    });
    return { passed: true, output: output.slice(0, 3000) };
  } catch (err) {
    const output =
      err instanceof Error && "stdout" in err
        ? String((err as { stdout: unknown }).stdout ?? "") +
          String((err as { stderr: unknown }).stderr ?? "")
        : String(err);
    return { passed: false, output: output.slice(0, 3000) };
  }
}

function extractFailedTests(output: string): string[] {
  const lines = output.split("\n");
  const failed: string[] = [];

  for (const line of lines) {
    // Jest / Vitest: ● Test name or ✕ test name
    const match = line.match(/(?:●|✕|FAIL|×)\s+(.+)/);
    if (match) failed.push(match[1].trim());
  }

  return [...new Set(failed)].slice(0, 20);
}

function buildFailureSummary(
  lint: CheckResult,
  test: CheckResult & { failedTests: string[] },
  build: CheckResult
): string {
  const parts: string[] = [];

  if (!lint.passed) {
    const firstErrors = lint.output.split("\n").slice(0, 5).join("\n");
    parts.push(`LINT FAILURES:\n${firstErrors}`);
  }

  if (!test.passed) {
    const summary =
      test.failedTests.length > 0
        ? `Failed tests: ${test.failedTests.slice(0, 5).join(", ")}`
        : test.output.split("\n").slice(0, 5).join("\n");
    parts.push(`TEST FAILURES:\n${summary}`);
  }

  if (!build.passed) {
    const firstErrors = build.output.split("\n").slice(0, 5).join("\n");
    parts.push(`BUILD FAILURES:\n${firstErrors}`);
  }

  return parts.join("\n\n");
}
