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
import { headCommit, uncommittedFiles } from "../lib/git.js";
import { checkInstalledVersions } from "../lib/packages.js";
import { cleanOutput, extractFailedTests, testSummary } from "../lib/output.js";
import type { AnalysisResult, ChecksResult, CheckResult, DependencyCheck } from "../types.js";

type Which = "lint" | "test" | "build" | "all";

/** Per-command limit for lint / test / build. */
const CHECK_TIMEOUT_MS = 10 * 60_000;

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
  // A previous result that fails its integrity check must not stop a fresh,
  // genuine verification from replacing it.
  let previous = 0;
  try {
    previous = readChecksIfExists(sessionId)?.iteration ?? 0;
  } catch {
    previous = 0;
  }
  const iteration = previous + 1;

  const dependencies = checkDependencies(cwd, session.upgrade.dependency, session.upgrade.toVersion);
  const lint = runCommand(analysis.lintCommand, cwd, command === "all" || command === "lint");
  const testRaw = runCommand(analysis.testCommand, cwd, command === "all" || command === "test");
  const build = runCommand(analysis.buildCommand, cwd, command === "all" || command === "build");

  const test = { ...testRaw, failedTests: testRaw.status === "failed" ? extractFailedTests(testRaw.output) : [] };
  const summary = testRaw.status === "skipped" ? null : testSummary(testRaw.output);

  const checks = [lint, test, build];
  const anyFailed = checks.some((c) => c.status === "failed") || dependencies.status === "failed";
  const anyRan = checks.some((c) => c.status !== "skipped");
  const allPassed = !anyFailed && anyRan;

  let dirty: string[] = [];
  try {
    dirty = uncommittedFiles(cwd);
  } catch {
    dirty = [];
  }

  return {
    iteration,
    timestamp: new Date().toISOString(),
    headCommit: headCommit(cwd),
    uncommittedFiles: dirty,
    dependencies,
    lint,
    test,
    build,
    allPassed,
    failureSummary: allPassed ? null : buildFailureSummary(dependencies, lint, test, build, anyRan, summary),
  };
}

/** Compact, human-readable rendering shared by run_checks and verify_migration. */
export function formatChecks(result: ChecksResult, includeOutput = false): string {
  const label = (c: { status: string }) => ({ passed: "✅ PASS", failed: "❌ FAIL", skipped: "➖ SKIPPED" })[c.status] ?? c.status;
  const dirty = result.uncommittedFiles ?? [];
  const lines = [
    `${result.allPassed ? "✅" : "❌"} Verification ${result.allPassed ? "PASSED" : "FAILED"} (iteration ${result.iteration}, commit ${result.headCommit?.slice(0, 7) ?? "n/a"})`,
    ...(dirty.length > 0
      ? [`⚠️ Ran on uncommitted changes (${dirty.slice(0, 3).join(", ")}${dirty.length > 3 ? " …" : ""}) — commit them (record the step) and verify again before a PR.`]
      : []),
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
      if (c.status === "failed") lines.push(``, `--- ${name} output (truncated) ---`, c.output.slice(-800));
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
      timeout: CHECK_TIMEOUT_MS,
      maxBuffer: 64 * 1024 * 1024,
      // CI keeps CRA/jest out of watch mode; colour codes would only add noise.
      env: { ...process.env, CI: "true", FORCE_COLOR: "0", NO_COLOR: "1" },
    });
    return { status: "passed", command: cmd, output: clip(cleanOutput(output, cwd)) };
  } catch (err) {
    const e = err as { stdout?: unknown; stderr?: unknown; signal?: string; code?: string };
    const output = String(e.stdout ?? "") + String(e.stderr ?? "");
    const timedOut = e.signal === "SIGTERM" || e.code === "ETIMEDOUT";
    return {
      status: "failed",
      command: cmd,
      output: clip(cleanOutput((timedOut ? `TIMED OUT after ${CHECK_TIMEOUT_MS / 60_000} minutes (a watch mode or a hanging test?)\n` : "") + (output || String(err)), cwd)),
    };
  }
}

/**
 * Keep the start and the end of long output: build tools print the first
 * error early, test runners print the failure summary last.
 */
export function clip(output: string, max = 4000): string {
  if (output.length <= max) return output;
  const head = Math.floor(max * 0.35);
  return `${output.slice(0, head)}\n… [${output.length - max} characters omitted] …\n${output.slice(-(max - head))}`;
}


function buildFailureSummary(
  deps: DependencyCheck,
  lint: CheckResult,
  test: CheckResult & { failedTests: string[] },
  build: CheckResult,
  anyRan: boolean,
  summary: string | null
): string {
  const parts: string[] = [];

  if (deps.status === "failed") {
    parts.push(`DEPENDENCY CHECK FAILED:\n${deps.output}\n(Apply the dependency step so the new versions are installed.)`);
  }
  if (lint.status === "failed") {
    parts.push(`LINT FAILURES:\n${lastLines(lint.output, 6)}`);
  }
  if (test.status === "failed") {
    const detail =
      test.failedTests.length > 0
        ? `Failed tests: ${test.failedTests.slice(0, 5).join("; ")}`
        : lastLines(test.output, 6);
    parts.push(`TEST FAILURES:\n${summary ? `${summary}\n` : ""}${detail}`);
  }
  if (build.status === "failed") {
    parts.push(`BUILD FAILURES:\n${firstErrorLines(build.output, 6)}`);
  }
  if (!anyRan) {
    parts.push("NOTHING VERIFIED: no lint/test/build command ran (none detected in package.json).");
  }
  return parts.join("\n\n");
}

function lastLines(text: string, n: number): string {
  return text.trim().split("\n").filter((l) => l.trim()).slice(-n).join("\n");
}

/** Lines around the first line that looks like an error; else the last lines. */
function firstErrorLines(text: string, n: number): string {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => /error|failed|cannot|not found/i.test(l));
  return i === -1 ? lastLines(text, n) : lines.slice(i, i + n).join("\n");
}
