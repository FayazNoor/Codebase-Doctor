/**
 * Tool: run_checks (internal)
 *
 * Spawns lint, test, and/or build commands in the repository's local clone
 * and checks that node_modules holds the upgraded package family.
 * verify_migration is the skill-facing wrapper (it also persists the result);
 * use run_checks directly for low-level debugging only.
 */

import { execSync } from "node:child_process";
import { assertSession, readAnalysis, readChecksIfExists, readSession } from "../lib/session.js";
import { headCommit } from "../lib/git.js";
import { checkInstalledVersions } from "../lib/packages.js";
import type { AnalysisResult, ChecksResult, CheckResult, DependencyCheck } from "../types.js";

type Which = "lint" | "test" | "build" | "all";

interface Input {
  sessionId: string;
  command: Which;
}

export async function runChecks(input: Input): Promise<string> {
  const { sessionId, command } = input;

  assertSession(sessionId);
  const analysis = readAnalysis(sessionId);

  const result = await spawnChecks(sessionId, analysis, command);
  return formatChecks(result, true);
}

// ---------------------------------------------------------------------------
// Core execution (exported for verify_migration)
// ---------------------------------------------------------------------------

export async function spawnChecks(
  sessionId: string,
  analysis: AnalysisResult,
  command: Which
): Promise<ChecksResult> {
  const session = readSession(sessionId);
  const cwd = session.repo.localPath;
  const iteration = (readChecksIfExists(sessionId)?.iteration ?? 0) + 1;

  const dependencies = checkDependencies(cwd, session.upgrade.dependency, session.upgrade.toVersion);
  const lint = runCommand(analysis.lintCommand, cwd, command === "all" || command === "lint");
  const testRaw = runCommand(analysis.testCommand, cwd, command === "all" || command === "test");
  const build = runCommand(analysis.buildCommand, cwd, command === "all" || command === "build");

  const test = { ...testRaw, failedTests: testRaw.status === "failed" ? extractFailedTests(testRaw.output) : [] };

  const checks = [lint, test, build];
  const anyFailed = checks.some((c) => c.status === "failed") || dependencies.status === "failed";
  const anyRan = checks.some((c) => c.status !== "skipped");
  const allPassed = !anyFailed && anyRan;

  return {
    iteration,
    timestamp: new Date().toISOString(),
    headCommit: headCommit(cwd),
    dependencies,
    lint,
    test,
    build,
    allPassed,
    failureSummary: allPassed ? null : buildFailureSummary(dependencies, lint, test, build, anyRan),
  };
}

/** Compact, human-readable rendering shared by run_checks and verify_migration. */
export function formatChecks(result: ChecksResult, includeOutput = false): string {
  const label = (c: { status: string }) => ({ passed: "✅ PASS", failed: "❌ FAIL", skipped: "➖ SKIPPED" })[c.status] ?? c.status;
  const lines = [
    `${result.allPassed ? "✅" : "❌"} Verification ${result.allPassed ? "PASSED" : "FAILED"} (iteration ${result.iteration}, commit ${result.headCommit?.slice(0, 7) ?? "n/a"})`,
    ``,
    `Deps:  ${label(result.dependencies)} ${Object.entries(result.dependencies.installed).map(([n, v]) => `${n}@${v ?? "missing"}`).join(", ")}`,
    `Lint:  ${label(result.lint)}${result.lint.command ? ` (${result.lint.command})` : ""}`,
    `Test:  ${label(result.test)}${result.test.command ? ` (${result.test.command})` : ""}${result.test.failedTests.length ? ` — ${result.test.failedTests.length} failed` : ""}`,
    `Build: ${label(result.build)}${result.build.command ? ` (${result.build.command})` : ""}`,
  ];
  if (!result.allPassed && result.failureSummary) {
    lines.push(``, `**Failure diagnosis for fix loop:**`, result.failureSummary);
  }
  if (includeOutput) {
    for (const [name, c] of [["lint", result.lint], ["test", result.test], ["build", result.build]] as const) {
      if (c.status === "failed") lines.push(``, `--- ${name} output (truncated) ---`, c.output.slice(0, 800));
    }
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function checkDependencies(cwd: string, dependency: string, toVersion: string): DependencyCheck {
  const check = checkInstalledVersions(cwd, dependency, toVersion);
  if (Object.keys(check.installed).length === 0) {
    return { status: "skipped", installed: {}, output: `${dependency} is not declared in package.json` };
  }
  return {
    status: check.ok ? "passed" : "failed",
    installed: check.installed,
    output: check.ok ? "Installed versions match the upgrade target." : check.problems.join("; "),
  };
}

function runCommand(cmd: string | null, cwd: string, shouldRun: boolean): CheckResult {
  if (!cmd) return { status: "skipped", command: null, output: "no script detected in package.json" };
  if (!shouldRun) return { status: "skipped", command: null, output: "not requested" };

  try {
    const output = execSync(cmd, {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5 * 60_000, // 5 minute timeout per command
      env: { ...process.env, CI: "true" }, // e.g. keeps CRA/jest out of watch mode
    });
    return { status: "passed", command: cmd, output: output.slice(0, 3000) };
  } catch (err) {
    const output =
      err instanceof Error && "stdout" in err
        ? String((err as unknown as { stdout: unknown }).stdout ?? "") +
          String((err as unknown as { stderr: unknown }).stderr ?? "")
        : String(err);
    return { status: "failed", command: cmd, output: output.slice(0, 3000) };
  }
}

function extractFailedTests(output: string): string[] {
  const failed: string[] = [];
  for (const line of output.split("\n")) {
    // Jest / Vitest: ● Test name or ✕ test name
    const match = line.match(/(?:●|✕|FAIL|×)\s+(.+)/);
    if (match) failed.push(match[1].trim());
  }
  return [...new Set(failed)].slice(0, 20);
}

function buildFailureSummary(
  deps: DependencyCheck,
  lint: CheckResult,
  test: CheckResult & { failedTests: string[] },
  build: CheckResult,
  anyRan: boolean
): string {
  const parts: string[] = [];

  if (deps.status === "failed") {
    parts.push(`DEPENDENCY CHECK FAILED:\n${deps.output}\n(Apply the dependency step so the new versions are installed.)`);
  }
  if (lint.status === "failed") {
    parts.push(`LINT FAILURES:\n${lint.output.split("\n").slice(0, 5).join("\n")}`);
  }
  if (test.status === "failed") {
    const summary =
      test.failedTests.length > 0
        ? `Failed tests: ${test.failedTests.slice(0, 5).join(", ")}`
        : test.output.split("\n").slice(0, 5).join("\n");
    parts.push(`TEST FAILURES:\n${summary}`);
  }
  if (build.status === "failed") {
    parts.push(`BUILD FAILURES:\n${build.output.split("\n").slice(0, 5).join("\n")}`);
  }
  if (!anyRan) {
    parts.push("NOTHING VERIFIED: no lint/test/build command ran (none detected in package.json).");
  }
  return parts.join("\n\n");
}
