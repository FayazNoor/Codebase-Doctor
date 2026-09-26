/**
 * Tool: approve_migration_plan
 *
 * Records the human approval of the CURRENT migration plan. This is the only
 * way to open the approval gate enforced by checkout_branch,
 * apply_migration_patch and create_pull_request.
 *
 * - `planId` must match the current plan (a regenerated plan needs a new approval).
 * - `confirmation` must be the user's literal reply, "approved".
 * - Idempotent: approving an already-approved plan returns the original record.
 */

import { assertSession, readPlan, writePlan, setPhase } from "../lib/session.js";

interface Input {
  sessionId: string;
  planId: string;
  confirmation: string;
}

export async function approveMigrationPlan(input: Input): Promise<string> {
  const { sessionId, planId, confirmation } = input;

  assertSession(sessionId);
  const plan = readPlan(sessionId);

  if (planId !== plan.planId) {
    throw new Error(
      `planId '${planId}' does not match the current plan '${plan.planId}'. ` +
        `The plan may have been regenerated — present the current plan to the user and approve that one.`
    );
  }
  if (confirmation.trim().toLowerCase() !== "approved") {
    throw new Error(
      `Approval not recorded: confirmation must be the user's reply "approved" (got "${confirmation.slice(0, 40)}"). ` +
        `If the user asked for changes, revise the plan instead.`
    );
  }

  if (plan.approval.approved && plan.approval.planId === plan.planId) {
    return `ℹ️ Plan ${plan.planId} was already approved at ${plan.approval.approvedAt}. Next step: checkout_branch`;
  }

  plan.approval = {
    approved: true,
    approvedAt: new Date().toISOString(),
    planId: plan.planId,
    confirmation: confirmation.trim(),
  };
  writePlan(sessionId, plan);
  setPhase(sessionId, "plan_approved");

  return [
    `✅ Plan ${plan.planId} approved at ${plan.approval.approvedAt} (${plan.steps.length} steps).`,
    `Next step: call checkout_branch, then apply_migration_patch for each step ID in order.`,
  ].join("\n");
}
