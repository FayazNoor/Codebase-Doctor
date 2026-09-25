/**
 * Tool: generate_migration_plan
 *
 * Builds a prioritised MigrationPlan from the analysis and requirements,
 * writes it to the session directory, and returns it as Markdown.
 */

import { randomUUID } from "node:crypto";
import {
  assertSession,
  readAnalysis,
  readRequirements,
  writePlan,
  setPhase,
} from "../lib/session.js";
import type { MigrationPlan, MigrationStep, BreakingChange } from "../types.js";

interface Input {
  sessionId: string;
}

export async function generateMigrationPlan(input: Input): Promise<string> {
  const { sessionId } = input;

  const session = assertSession(sessionId);
  const analysis = readAnalysis(sessionId);
  const requirements = readRequirements(sessionId);

  const { dependency, fromVersion, toVersion } = session.upgrade;
  const blastRadius = analysis.blastRadius;

  // Build steps from breaking changes + standard migration steps
  const steps: MigrationStep[] = [];
  let order = 1;

  // Step 1: Always update the package version first
  steps.push({
    id: randomUUID(),
    order: order++,
    title: `Update ${dependency} to ${toVersion}`,
    description:
      `Update the version of \`${dependency}\` in package.json from \`${fromVersion}\` ` +
      `to \`${toVersion}\` and install updated packages.`,
    files: ["package.json"],
    changeType: "config",
    breakingChangeId: null,
    automatable: true,
    approved: false,
    applied: false,
  });

  // Steps for each breaking change (high severity first)
  const sorted = [...requirements.breakingChanges].sort((a, b) => {
    const rank = { high: 0, medium: 1, low: 2 };
    return rank[a.severity] - rank[b.severity];
  });

  for (const bc of sorted) {
    const affectedFiles = getAffectedFiles(bc, analysis.dependencyUsages.map((u) => ({
      file: u.file,
      breakingChangeIds: u.breakingChangeIds,
    })));

    steps.push({
      id: randomUUID(),
      order: order++,
      title: bc.description,
      description: buildStepDescription(bc),
      files: affectedFiles,
      changeType: bc.automatable ? "codemod" : "manual",
      breakingChangeId: bc.id,
      automatable: bc.automatable,
      approved: false,
      applied: false,
    });
  }

  // Final step: verify tests still pass
  steps.push({
    id: randomUUID(),
    order: order++,
    title: "Update and verify tests",
    description:
      "Update any test utilities that changed in the new version and ensure the full test suite passes.",
    files: analysis.dependencyUsages
      .filter((u) => u.file.match(/\.(test|spec)\.(tsx?|jsx?)$/))
      .map((u) => u.file),
    changeType: "test",
    breakingChangeId: null,
    automatable: false,
    approved: false,
    applied: false,
  });

  const estimatedEffort = estimateEffort(steps);

  const plan: MigrationPlan = {
    sessionId,
    createdAt: new Date().toISOString(),
    summary: buildPlanSummary(dependency, fromVersion, toVersion, steps, blastRadius),
    estimatedEffort,
    breakingChanges: requirements.breakingChanges,
    steps,
  };

  writePlan(sessionId, plan);
  setPhase(sessionId, "plan_ready");

  return renderPlanAsMarkdown(plan, dependency, fromVersion, toVersion);
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function getAffectedFiles(
  bc: BreakingChange,
  usages: Array<{ file: string; breakingChangeIds: string[] }>
): string[] {
  return usages
    .filter((u) => u.breakingChangeIds.includes(bc.id))
    .map((u) => u.file);
}

function buildStepDescription(bc: BreakingChange): string {
  let desc = bc.description;
  if (bc.affectedApis.length > 0) {
    desc += `\n\nAffected APIs: \`${bc.affectedApis.join("`, `")}\``;
  }
  if (bc.codemods.length > 0) {
    desc += `\n\nAvailable codemods: ${bc.codemods.join(", ")}`;
  }
  if (!bc.automatable && bc.manualAction) {
    desc += `\n\n⚠️ Manual action required: ${bc.manualAction}`;
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
  blastRadius: ReturnType<typeof readAnalysis>["blastRadius"]
): string {
  const manual = steps.filter((s) => !s.automatable).length;
  const auto = steps.filter((s) => s.automatable).length;
  const fileCount = blastRadius?.affectedFiles ?? "unknown";
  return (
    `Upgrade ${dep} from ${from} to ${to} across ${fileCount} affected files. ` +
    `${steps.length} migration steps: ${auto} automatable, ${manual} requiring manual changes.`
  );
}

function renderPlanAsMarkdown(
  plan: MigrationPlan,
  dep: string,
  from: string,
  to: string
): string {
  const lines: string[] = [
    `## Migration Plan: ${dep} ${from} → ${to}`,
    ``,
    `**Summary:** ${plan.summary}`,
    `**Estimated effort:** ${plan.estimatedEffort.toUpperCase()}`,
    `**Steps:** ${plan.steps.length}`,
    ``,
    `### Steps`,
    ``,
  ];

  for (const step of plan.steps) {
    lines.push(`#### ${step.order}. ${step.title}`);
    lines.push(`- **Type:** ${step.changeType}`);
    lines.push(`- **Automatable:** ${step.automatable ? "Yes" : "No"}`);
    if (step.files.length > 0) {
      lines.push(`- **Files (${step.files.length}):** ${step.files.slice(0, 5).join(", ")}${step.files.length > 5 ? ` +${step.files.length - 5} more` : ""}`);
    }
    lines.push(`- **Description:** ${step.description.split("\n")[0]}`);
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(`**Review the plan above and type "approved" to begin implementation.**`);
  lines.push(`Or describe any changes you'd like to make before proceeding.`);

  return lines.join("\n");
}
