/**
 * Tool: load_migration_requirements
 *
 * Builds the breaking-change rule set for this upgrade (canonical knowledge
 * base, validated/augmented by user-supplied docs text) and keeps only the
 * rules for which the repository contains concrete evidence.
 *
 * Canonical IDs (react-bc-*) are preserved when docs are supplied, so the
 * automated transforms keyed on them stay reachable.
 */

import {
  assertSession,
  readAnalysis,
  readPlanIfExists,
  readRequirementsIfExists,
  writeRequirements,
} from "../lib/session.js";
import { buildRequirements } from "../lib/requirements.js";

interface Input {
  sessionId: string;
  docsText?: string;
}

export async function loadMigrationRequirements(input: Input): Promise<string> {
  const { sessionId, docsText } = input;

  const session = assertSession(sessionId);
  const { dependency, fromVersion, toVersion } = session.upgrade;
  const analysis = readAnalysis(sessionId);

  const requirements = buildRequirements({
    dependency,
    fromVersion,
    toVersion,
    usages: analysis.dependencyUsages,
    docsText,
  });

  // Once a plan is approved its inputs are frozen: re-running with identical
  // results is a no-op, but a different rule set must not silently change the
  // approved plan's basis.
  const plan = readPlanIfExists(sessionId);
  const previous = readRequirementsIfExists(sessionId);
  if (plan?.approval?.approved && previous && JSON.stringify(previous) !== JSON.stringify(requirements)) {
    throw new Error(
      "The migration plan for this session is already approved; its requirements cannot change. " +
        "Start a new session with analyze_dependency_usage to re-plan with different docs."
    );
  }

  writeRequirements(sessionId, requirements);

  // Compact output for Bob context
  const applicable = requirements.breakingChanges;
  const auto = applicable.filter((bc) => bc.automatable);
  const manual = applicable.filter((bc) => !bc.automatable);
  const docsOnly = applicable.filter((bc) => bc.source === "docs");

  return [
    `📋 Migration requirements loaded for ${dependency} ${fromVersion} → ${toVersion}`,
    `Rules: ${requirements.knowledgeBase ?? "no built-in rules"}` +
      (requirements.docsSupplied ? " + supplied docs (validation/augmentation)" : ""),
    ...requirements.warnings.map((w) => `⚠️ ${w}`),
    ``,
    `Found ${applicable.length} applicable breaking changes:`,
    ...applicable.map(
      (bc) =>
        `  [${bc.severity.toUpperCase()}] ${bc.id}: ${bc.description}` +
        (bc.automatable ? " (automatable)" : " (manual)") +
        (bc.docsConfirmed === true ? " [in docs]" : bc.docsConfirmed === false ? " [not in docs]" : "")
    ),
    ``,
    `⚡ Automatable: ${auto.length} | 🔧 Manual: ${manual.length}` +
      (docsOnly.length > 0 ? ` | 📄 Docs-only (manual): ${docsOnly.length}` : ""),
    ``,
    `Next step: call calculate_migration_blast_radius`,
  ].join("\n");
}
