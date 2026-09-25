/**
 * Risk scoring — blast-radius calculation.
 *
 * Implements the scoring model documented in .bob/skills/migration-doctor/severity-guide.md.
 * The unit tests for this module use the reference scores from that file as expected bounds.
 */

import type { DependencyUsage, BlastRadiusReport, BreakingChange } from "../types.js";

// ---------------------------------------------------------------------------
// Scoring constants (mirrors severity-guide.md)
// ---------------------------------------------------------------------------

const POINTS = {
  importsGte5Symbols: 20,
  importsGte2BreakingSymbols: 30,
  isEntryPoint: 15,
  reExportsDependency: 25,
  usesRemovedApi: 40,
  usesDeprecatedApi: 25,
  usesChangedSignature: 20,
  usesChangedAsyncBehaviour: 30,
  usesChangedDefaults: 10,
  testWithChangedUtils: 20,
  testWithStableUtils: -10,
  isBootstrapFile: 20,
  isConfigFile: 15,
} as const;

const ENTRY_POINT_PATTERNS = /\b(index|main|App|app)\.(tsx?|jsx?|mjs|cjs)$/;
const BOOTSTRAP_PATTERNS = /\b(render|mount|createApp|createRoot|hydrate)\b/;
const CONFIG_FILE_PATTERNS = /\.(config|rc)\.(tsx?|jsx?|mjs|cjs|json)$/;
const TEST_FILE_PATTERNS = /\.(test|spec)\.(tsx?|jsx?|mjs|cjs)$/;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Score a single DependencyUsage against the known breaking changes.
 * Mutates `usage.riskScore` and `usage.breakingChangeIds` in place.
 */
export function scoreUsage(
  usage: DependencyUsage,
  breakingChanges: BreakingChange[],
  allUsagesInFile: DependencyUsage[]
): void {
  let score = 0;

  const importedSymbols = parseImportedSymbols(usage.importSpecifier);
  const breakingApiSet = new Set(breakingChanges.flatMap((bc) => bc.affectedApis));

  const breakingSymbolsUsed = importedSymbols.filter((s) => breakingApiSet.has(s));

  // Import volume
  if (importedSymbols.length >= 5) score += POINTS.importsGte5Symbols;
  if (breakingSymbolsUsed.length >= 2) score += POINTS.importsGte2BreakingSymbols;

  // Entry point / config / bootstrap
  if (ENTRY_POINT_PATTERNS.test(usage.file)) score += POINTS.isEntryPoint;
  if (CONFIG_FILE_PATTERNS.test(usage.file)) score += POINTS.isConfigFile;
  if (BOOTSTRAP_PATTERNS.test(usage.usageContext)) score += POINTS.isBootstrapFile;

  // Test file modifiers
  const isTest = TEST_FILE_PATTERNS.test(usage.file);

  // API-level risk from breaking changes
  for (const bc of breakingChanges) {
    const overlappingApis = importedSymbols.filter((s) => bc.affectedApis.includes(s));
    if (overlappingApis.length === 0) continue;

    usage.breakingChangeIds.push(bc.id);

    switch (bc.severity) {
      case "high":
        if (!bc.automatable) score += POINTS.usesRemovedApi;
        else score += POINTS.usesDeprecatedApi;
        break;
      case "medium":
        score += POINTS.usesChangedSignature;
        break;
      case "low":
        score += POINTS.usesChangedDefaults;
        break;
    }

    if (isTest) {
      score += POINTS.testWithChangedUtils;
    }
  }

  // Test file with no breaking changes
  if (isTest && usage.breakingChangeIds.length === 0) {
    score += POINTS.testWithStableUtils;
  }

  usage.riskScore = Math.max(0, Math.min(100, score));
}

/**
 * Score all usages and return a BlastRadiusReport.
 */
export function calculateBlastRadius(
  usages: DependencyUsage[],
  breakingChanges: BreakingChange[]
): BlastRadiusReport {
  // Group usages by file
  const byFile = new Map<string, DependencyUsage[]>();
  for (const u of usages) {
    const list = byFile.get(u.file) ?? [];
    list.push(u);
    byFile.set(u.file, list);
  }

  // Score each file (use the max score across all usages in that file)
  const fileScores: Array<{ file: string; riskScore: number; reason: string }> = [];

  for (const [file, fileUsages] of byFile) {
    for (const u of fileUsages) {
      scoreUsage(u, breakingChanges, fileUsages);
    }
    const maxScore = Math.max(...fileUsages.map((u) => u.riskScore));
    const topUsage = fileUsages.find((u) => u.riskScore === maxScore)!;
    const reason = topUsage.breakingChangeIds.length > 0
      ? `Uses ${topUsage.breakingChangeIds.join(", ")}`
      : "Uses dependency (no matching breaking changes)";

    fileScores.push({ file, riskScore: maxScore, reason });
  }

  const high = fileScores.filter((f) => f.riskScore >= 70).length;
  const medium = fileScores.filter((f) => f.riskScore >= 40 && f.riskScore < 70).length;
  const low = fileScores.filter((f) => f.riskScore > 0 && f.riskScore < 40).length;

  const topAffectedFiles = [...fileScores]
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 10);

  return {
    totalFiles: byFile.size,
    affectedFiles: fileScores.filter((f) => f.riskScore > 0).length,
    riskDistribution: { high, medium, low },
    topAffectedFiles,
  };
}

// ---------------------------------------------------------------------------
// Blast radius label (mirrors severity-guide.md thresholds)
// ---------------------------------------------------------------------------

export function blastRadiusLabel(report: BlastRadiusReport): string {
  const h = report.riskDistribution.high;
  if (h === 0) return "✅ Minimal blast radius";
  if (h <= 5) return "🟡 Moderate blast radius";
  if (h <= 20) return "🟠 Significant blast radius — review plan carefully";
  return "🔴 Large blast radius — consider splitting into multiple PRs";
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function parseImportedSymbols(importSpecifier: string): string[] {
  const symbols: string[] = [];
  const namedMatch = importSpecifier.match(/\{([^}]+)\}/);
  if (namedMatch) {
    for (const s of namedMatch[1].split(",")) {
      symbols.push(s.trim().split(" as ")[0].trim());
    }
  }
  const defaultMatch = importSpecifier.match(/^([A-Za-z_$][A-Za-z0-9_$]*)/);
  if (defaultMatch && !importSpecifier.trim().startsWith("{")) {
    symbols.push(defaultMatch[1]);
  }
  return symbols.filter(Boolean);
}
