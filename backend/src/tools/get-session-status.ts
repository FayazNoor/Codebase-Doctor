/**
 * Tool: get_session_status (read-only)
 *
 * Recovery aid after a Bob context reset or an interrupted run:
 *  - without a sessionId: lists the most recent sessions;
 *  - with a sessionId: phase, approval, every step's status, the latest
 *    verification and PR, and the single next action to take.
 */

import {
  assertSession,
  listSessions,
  readAnalysis,
  readChecksIfExists,
  readPlanIfExists,
  readRequirementsIfExists,
} from "../lib/session.js";
import { headCommit, uncommittedFiles } from "../lib/git.js";
import { STEP_ICON } from "./generate-migration-plan.js";
import type { ChecksResult, MigrationPlan } from "../types.js";

interface Input {
  sessionId?: string;
}

export async function getSessionStatus(input: Input): Promise<string> {
  if (!input.sessionId) {
    const sessions = listSessions(10);
    if (sessions.length === 0) return "No sessions yet. Start one with analyze_dependency_usage.";
    return [
      `Recent sessions (newest first):`,
      ...sessions.map((s) => `- ${s.id} · ${s.repo} · ${s.upgrade} · ${s.phase} · ${s.createdAt.slice(0, 16).replace("T", " ")}`),
      ``,
      `Call get_session_status with a sessionId for details and the next step.`,
    ].join("\n");
  }

  const sessionId = input.sessionId;
  const session = assertSession(sessionId);
  const analysis = safe(() => readAnalysis(sessionId));
  const requirements = safe(() => readRequirementsIfExists(sessionId));
  const plan = safe(() => readPlanIfExists(sessionId));
  let checks: ChecksResult | null = null;
  let checksProblem: string | null = null;
  try {
    checks = readChecksIfExists(sessionId);
  } catch (err) {
    checksProblem = (err as Error).message;
  }

  const head = session.repo.localPath ? safe(() => headCommit(session.repo.localPath)) : null;
  const dirty = session.repo.localPath ? safe(() => uncommittedFiles(session.repo.localPath)) ?? [] : [];

  const lines = [
    `Session ${session.id} — ${session.repo.owner ? `${session.repo.owner}/${session.repo.name}` : session.repo.url}`,
    `${session.upgrade.dependency} ${session.upgrade.fromVersion} → ${session.upgrade.toVersion} · phase: ${session.phase} · branch ${session.migrationBranch}`,
  ];
  if (plan) {
    lines.push(
      `Plan ${plan.planId}: ${plan.approval.approved ? `approved ${plan.approval.approvedAt}` : "NOT approved"}`,
      ...plan.steps.map((s) => `  ${STEP_ICON[s.status]} ${s.id} — ${s.status}`)
    );
  }
  if (checks) {
    const stale = head && checks.headCommit !== head ? " (STALE: HEAD moved since)" : "";
    lines.push(`Verification #${checks.iteration}: ${checks.allPassed ? "PASSED" : "FAILED"} on ${checks.headCommit?.slice(0, 7) ?? "n/a"}${stale}`);
  } else if (checksProblem) {
    lines.push(`Verification: ⚠️ ${checksProblem}`);
  }
  if (dirty.length > 0) lines.push(`Uncommitted changes: ${dirty.slice(0, 5).join(", ")}`);
  if (session.pullRequest) lines.push(`PR: ${session.pullRequest.url}`);
  lines.push(``, `Next: ${nextAction(Boolean(analysis), Boolean(requirements), Boolean(analysis?.blastRadius), plan, checks, head, dirty, Boolean(session.pullRequest), Boolean(session.baseCommit))}`);
  return lines.join("\n");
}

function nextAction(
  analysed: boolean,
  hasRequirements: boolean,
  hasBlastRadius: boolean,
  plan: MigrationPlan | null,
  checks: ChecksResult | null,
  head: string | null,
  dirty: string[],
  hasPr: boolean,
  onBranch: boolean
): string {
  if (!analysed) return "analysis did not complete — start a new session with analyze_dependency_usage.";
  if (!hasRequirements) return "load_migration_requirements";
  if (!hasBlastRadius) return "calculate_migration_blast_radius";
  if (!plan) return "generate_migration_plan";
  if (!plan.approval.approved) return `present plan ${plan.planId} and wait for the user's "approved", then approve_migration_plan`;
  if (!onBranch) return "checkout_branch";
  const failed = plan.steps.find((s) => s.status === "failed");
  if (failed) return `retry ${failed.id} with apply_migration_patch (it failed: ${failed.outcome?.note.slice(0, 120) ?? ""})`;
  const pending = plan.steps.find((s) => s.status === "pending");
  if (pending) return `apply_migration_patch { stepId: "${pending.id}" }`;
  if (dirty.length > 0) return "commit the working-tree changes via apply_migration_patch (markManualComplete + note), then verify_migration";
  if (!checks || checks.headCommit !== head) return "verify_migration";
  if (!checks.allPassed) return `fix the verification failures (iteration ${checks.iteration}), then verify_migration again`;
  if (hasPr) return "done — generate_report (html) to show the final report";
  return 'generate_report (format "html") for the artifact, then create_pull_request';
}

function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}
