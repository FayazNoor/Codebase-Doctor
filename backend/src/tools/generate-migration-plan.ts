/**
 * Tool: generate_migration_plan
 *
 * Builds a prioritised MigrationPlan from the analysis and requirements,
 * writes it to the session directory, and returns it as Markdown.
 *
 * Restart-safe: step IDs are deterministic ("step-2-react-bc-1"), and calling
 * the tool again with unchanged inputs returns the existing plan (statuses and
 * approval intact). If inputs changed, the plan is rebuilt only while no step
 * has been executed; a changed plan gets a new planId and needs re-approval.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  assertSession,
  readAnalysis,
  readRequirements,
  readPlanIfExists,
  writePlan,
  setPhase,
} from "../lib/session.js";
import { isTestFile } from "../lib/ast.js";
import { planPackageChanges, LOCKFILES } from "../lib/packages.js";
import { hasTransform } from "../lib/transforms.js";
import type { MigrationPlan, MigrationStep, BreakingChange, DependencyUsage } from "../types.js";

interface Input {
  sessionId: string;
}

export async function generateMigrationPlan(input: Input): Promise<string> {
  const { sessionId } = input;

  const session = assertSession(sessionId);
  const analysis = readAnalysis(sessionId);
  const requirements = readRequirements(sessionId);
  const { dependency, fromVersion, toVersion } = session.upgrade;

  if (!analysis.blastRadius) {
    throw new Error("Blast radius has not been calculated. Call calculate_migration_blast_radius first.");
  }

  const inputFingerprint = hash({
    requirements: requirements.breakingChanges,
    usages: analysis.dependencyUsages.map((u) => [u.file, u.line, u.api, u.breakingChangeIds]),
    toVersion,
  });

  const existing = readPlanIfExists(sessionId);
  if (existing && existing.inputFingerprint === inputFingerprint) {
    return renderPlanAsMarkdown(existing, dependency, fromVersion, toVersion, "unchanged — existing plan returned");
  }
  if (existing && existing.steps.some((s) => s.status !== "pending")) {
    throw new Error(
      "Implementation has already started for this session, so the plan cannot be regenerated. " +
        "Continue with the existing plan, or start a new session with analyze_dependency_usage."
    );
  }

  const steps = buildSteps(
    session.repo.localPath,
    dependency,
    toVersion,
    analysis.packageManager,
    requirements.breakingChanges,
    analysis.dependencyUsages
  );
  const planId = hash({ steps: steps.map(({ id, title, files, changeType, packageChanges }) => ({ id, title, files, changeType, packageChanges })) }).slice(0, 12);

  const plan: MigrationPlan = {
    sessionId,
    planId,
    inputFingerprint,
    createdAt: new Date().toISOString(),
    summary: buildPlanSummary(dependency, fromVersion, toVersion, steps, analysis.blastRadius.affectedFiles),
    estimatedEffort: estimateEffort(steps),
    breakingChanges: requirements.breakingChanges,
    steps,
    // Approval survives only if the plan content is byte-for-byte the same plan.
    approval:
      existing && existing.planId === planId
        ? existing.approval
        : { approved: false, approvedAt: null, planId: null, confirmation: null },
  };

  writePlan(sessionId, plan);
  setPhase(sessionId, plan.approval.approved ? "plan_approved" : "plan_ready");

  return renderPlanAsMarkdown(plan, dependency, fromVersion, toVersion, existing ? "inputs changed — plan rebuilt" : null);
}

// ---------------------------------------------------------------------------
// Step construction
// ---------------------------------------------------------------------------

function buildSteps(
  localPath: string,
  dependency: string,
  toVersion: string,
  packageManager: keyof typeof LOCKFILES,
  breakingChanges: BreakingChange[],
  usages: DependencyUsage[]
): MigrationStep[] {
  const steps: MigrationStep[] = [];
  let order = 1;

  // Step 1: dependency family version update + install (lockfile included)
  // Never resolve package.json against the server's own cwd.
  const packageChanges = localPath ? planPackageChanges(localPath, dependency, toVersion) : [];
  const lockfile = LOCKFILES[packageManager];
  const hasLockfile = localPath !== "" && fs.existsSync(path.join(localPath, lockfile));
  const names = packageChanges.map((c) => c.name);
  steps.push({
    id: `step-${order}-dependencies`,
    order: order++,
    title: `Update ${names.length > 0 ? names.join(", ") : dependency} to ${toVersion} and install`,
    description:
      (packageChanges.length > 0
        ? packageChanges.map((c) => `\`${c.name}\` ${c.from} → ${c.to} (${c.section})`).join("; ")
        : `No declared version of \`${dependency}\` needs changing in package.json.`) +
      `. Then run \`${packageManager} install\`` +
      (hasLockfile ? ` (updates ${lockfile})` : " (no lockfile in repo — none is created)") +
      " and verify the installed versions. Unrelated dependencies are not changed.",
    files: hasLockfile ? ["package.json", lockfile] : ["package.json"],
    changeType: "config",
    breakingChangeId: null,
    automatable: true,
    status: "pending",
    packageChanges,
  });

  // Steps for each breaking change (high severity first, stable within tier)
  const rank = { high: 0, medium: 1, low: 2 };
  const sorted = [...breakingChanges].sort((a, b) => rank[a.severity] - rank[b.severity]);

  for (const bc of sorted) {
    const files = [...new Set(usages.filter((u) => u.breakingChangeIds.includes(bc.id)).map((u) => u.file))].sort();
    // Automation is attached only to canonical rules with a known transform.
    const automatable = bc.automatable && hasTransform(bc.id);
    steps.push({
      id: `step-${order}-${bc.id}`,
      order: order++,
      title: bc.description,
      description: buildStepDescription(bc, automatable),
      files,
      changeType: automatable ? "codemod" : "manual",
      breakingChangeId: bc.id,
      automatable,
      status: "pending",
    });
  }

  // Final step: tests that use the dependency family
  const testFiles = [...new Set(usages.filter((u) => isTestFile(u.file)).map((u) => u.file))].sort();
  steps.push({
    id: `step-${order}-tests`,
    order: order++,
    title: "Update and verify tests",
    description:
      "Update any test utilities that changed in the new version, then confirm the full suite passes with verify_migration. " +
      "This step makes no automated source changes.",
    files: testFiles,
    changeType: "test",
    breakingChangeId: null,
    automatable: false,
    status: "pending",
  });

  return steps;
}

function buildStepDescription(bc: BreakingChange, automatable: boolean): string {
  let desc = bc.description;
  if (bc.affectedApis.length > 0) {
    desc += `\n\nAffected APIs: \`${bc.affectedApis.join("`, `")}\``;
  }
  if (bc.codemods.length > 0) {
    desc += `\n\nAvailable codemods: ${bc.codemods.join(", ")}`;
  }
  if (!automatable && bc.manualAction) {
    desc += `\n\n⚠️ Manual action required: ${bc.manualAction}`;
  }
  if (bc.source === "docs") {
    desc += "\n\nSource: user-supplied migration docs (no automated transform).";
  }
  return desc;
}

function estimateEffort(steps: MigrationStep[]): "low" | "medium" | "high" {
  const manualSteps = steps.filter((s) => !s.automatable).length;
  const totalFiles = new Set(steps.flatMap((s) => s.files)).size;
  if (manualSteps >= 5 || totalFiles >= 30) return "high";
  if (manualSteps >= 2 || totalFiles >= 10) return "medium";
  return "low";
}

function buildPlanSummary(
  dep: string,
  from: string,
  to: string,
  steps: MigrationStep[],
  affectedFiles: number
): string {
  const manual = steps.filter((s) => !s.automatable).length;
  const auto = steps.filter((s) => s.automatable).length;
  return (
    `Upgrade ${dep} from ${from} to ${to} across ${affectedFiles} affected files. ` +
    `${steps.length} migration steps: ${auto} automatable, ${manual} requiring manual changes or review.`
  );
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function renderPlanAsMarkdown(
  plan: MigrationPlan,
  dep: string,
  from: string,
  to: string,
  note: string | null
): string {
  const lines: string[] = [
    `## Migration Plan: ${dep} ${from} → ${to}`,
    ``,
    `**Plan ID:** \`${plan.planId}\`${note ? ` (${note})` : ""}`,
    `**Summary:** ${plan.summary}`,
    `**Estimated effort:** ${plan.estimatedEffort.toUpperCase()}`,
    `**Steps:** ${plan.steps.length}`,
    `**Approval:** ${plan.approval.approved ? `approved at ${plan.approval.approvedAt}` : "NOT approved — no code will be changed until it is"}`,
    ``,
    `### Steps`,
    ``,
  ];

  for (const step of plan.steps) {
    lines.push(`#### ${step.order}. ${step.title}`);
    lines.push(`- **Step ID:** \`${step.id}\` — status: ${step.status}`);
    lines.push(`- **Type:** ${step.changeType}`);
    lines.push(`- **Automatable:** ${step.automatable ? "Yes" : "No"}`);
    if (step.files.length > 0) {
      lines.push(`- **Files (${step.files.length}):** ${step.files.slice(0, 5).join(", ")}${step.files.length > 5 ? ` +${step.files.length - 5} more` : ""}`);
    }
    lines.push(`- **Description:** ${step.description.split("\n")[0]}`);
    lines.push(``);
  }

  lines.push(`---`);
  if (!plan.approval.approved) {
    lines.push(`**Review the plan above and type "approved" to begin implementation.**`);
    lines.push(`Or describe any changes you'd like to make before proceeding.`);
    lines.push(`(After the user approves: call approve_migration_plan with planId \`${plan.planId}\` and confirmation "approved".)`);
  } else {
    lines.push(`Plan approved — next step: checkout_branch, then apply_migration_patch for each step ID.`);
  }

  return lines.join("\n");
}
