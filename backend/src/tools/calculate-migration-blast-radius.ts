/**
 * Tool: calculate_migration_blast_radius
 *
 * Runs the risk-scoring algorithm against the analysed usages and migration
 * requirements, producing a ranked BlastRadiusReport.
 */

import {
  assertSession,
  readAnalysis,
  readRequirements,
  writeAnalysis,
} from "../lib/session.js";
import { calculateBlastRadius, blastRadiusLabel } from "../lib/risk.js";
import { resolveEcosystem } from "../lib/ecosystem.js";

interface Input {
  sessionId: string;
}

export async function calculateMigrationBlastRadius(input: Input): Promise<string> {
  const { sessionId } = input;

  const session = assertSession(sessionId);

  const analysis = readAnalysis(sessionId);
  const requirements = readRequirements(sessionId);
  const { bootstrapApis } = resolveEcosystem(session.upgrade.dependency);

  // Score all usages from concrete API evidence. Deterministic and idempotent:
  // breakingChangeIds are recomputed from scratch on every call.
  const report = calculateBlastRadius(
    analysis.dependencyUsages,
    requirements.breakingChanges,
    { bootstrapApis }
  );

  // Persist updated analysis (usages now have riskScore + breakingChangeIds)
  analysis.blastRadius = report;
  writeAnalysis(sessionId, analysis);

  const label = blastRadiusLabel(report);
  const top5 = report.topAffectedFiles.slice(0, 5);

  return [
    `🎯 Blast Radius: ${label}`,
    ``,
    `Total files using dependency: ${report.totalFiles}`,
    `Affected files:               ${report.affectedFiles}`,
    `Risk distribution:            🔴 High: ${report.riskDistribution.high}  🟡 Medium: ${report.riskDistribution.medium}  🟢 Low: ${report.riskDistribution.low}`,
    ``,
    `Top affected files:`,
    ...top5.map(
      (f) => `  [${f.riskScore}/100] ${f.file}  — ${f.reason}`
    ),
    report.topAffectedFiles.length > 5
      ? `  ... and ${report.topAffectedFiles.length - 5} more`
      : "",
    ``,
    `Next step: call generate_migration_plan (then switch to Plan mode to present it)`,
  ]
    .filter((l) => l !== null)
    .join("\n");
}
