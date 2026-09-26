/**
 * Risk scoring — evidence-based blast-radius calculation.
 *
 * Implements the scoring model documented in
 * .bob/skills/migration-doctor/severity-guide.md. A file's score is derived
 * ONLY from concrete API usages found by lib/ast.ts (e.g. a real
 * `ReactDOM.render(...)` call) — importing a namespace such as `ReactDOM` is
 * not, by itself, evidence that a breaking API is used.
 *
 *   score = Σ severity points of each distinct breaking change evidenced in the file
 *         + context modifiers (only when the file has ≥1 breaking-change hit)
 *   capped to 0–100
 */

import type { ApiRef } from "./ecosystem.js";
import { isTestFile } from "./ast.js";
import type { DependencyUsage, BlastRadiusReport, BreakingChange } from "../types.js";

// ---------------------------------------------------------------------------
// Scoring constants (mirrors severity-guide.md)
// ---------------------------------------------------------------------------

export const POINTS = {
  severity: { high: 40, medium: 20, low: 10 },
  /** Non-test file calls an API that bootstraps the application root. */
  rootBootstrap: 30,
  /** Test file whose harness is affected by a breaking change. */
  testHarness: 20,
} as const;

export const TIERS = { high: 70, medium: 40 } as const;

export interface ScoreContext {
  /** APIs that bootstrap the app root (from the ecosystem definition). */
  bootstrapApis?: ApiRef[];
}

export interface FileScore {
  file: string;
  riskScore: number;
  breakingChangeIds: string[];
  reason: string;
}

// ---------------------------------------------------------------------------
// Evidence matching
// ---------------------------------------------------------------------------

/**
 * Return the IDs of breaking changes that a single usage is concrete evidence
 * for. Import records are never evidence on their own.
 */
export function matchBreakingChanges(usage: DependencyUsage, breakingChanges: BreakingChange[]): string[] {
  if (usage.kind !== "api" || !usage.api) return [];
  const ids: string[] = [];
  for (const bc of breakingChanges) {
    if (bc.detect && bc.detect.length > 0) {
      const hit = bc.detect.some(
        (p) =>
          p.module === usage.module &&
          p.api === usage.api &&
          (p.minArgs === undefined || (usage.argCount !== null && usage.argCount >= p.minArgs))
      );
      if (hit) ids.push(bc.id);
    } else if (bc.affectedApis.includes(usage.api)) {
      // Fallback for rules without machine patterns (docs-only / other ecosystems).
      ids.push(bc.id);
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------
// File scoring
// ---------------------------------------------------------------------------

/**
 * Score one file from its usages. Mutates each usage's `breakingChangeIds`
 * (reset first, so repeated calls are idempotent) and `riskScore`.
 */
export function scoreFile(
  file: string,
  fileUsages: DependencyUsage[],
  breakingChanges: BreakingChange[],
  ctx: ScoreContext = {}
): FileScore {
  const hitIds = new Set<string>();
  for (const u of fileUsages) {
    u.breakingChangeIds = matchBreakingChanges(u, breakingChanges);
    for (const id of u.breakingChangeIds) hitIds.add(id);
  }

  const parts: string[] = [];
  let score = 0;
  const hits = breakingChanges.filter((bc) => hitIds.has(bc.id));
  for (const bc of hits) {
    const pts = POINTS.severity[bc.severity];
    score += pts;
    parts.push(`${bc.id} +${pts}`);
  }

  if (hits.length > 0) {
    const isTest = isTestFile(file);
    const bootstraps = (ctx.bootstrapApis ?? []).some((b) =>
      fileUsages.some((u) => u.kind === "api" && u.module === b.module && u.api === b.api && u.argCount !== null)
    );
    if (bootstraps && !isTest) {
      score += POINTS.rootBootstrap;
      parts.push(`root bootstrap +${POINTS.rootBootstrap}`);
    }
    if (isTest) {
      score += POINTS.testHarness;
      parts.push(`test harness +${POINTS.testHarness}`);
    }
  }

  const riskScore = Math.max(0, Math.min(100, score));
  for (const u of fileUsages) u.riskScore = riskScore;

  return {
    file,
    riskScore,
    breakingChangeIds: hits.map((bc) => bc.id),
    reason: parts.length > 0 ? parts.join(", ") : "Only stable APIs used (no breaking-change evidence)",
  };
}

/**
 * Score all usages and return a BlastRadiusReport.
 */
export function calculateBlastRadius(
  usages: DependencyUsage[],
  breakingChanges: BreakingChange[],
  ctx: ScoreContext = {}
): BlastRadiusReport {
  const byFile = new Map<string, DependencyUsage[]>();
  for (const u of usages) {
    const list = byFile.get(u.file) ?? [];
    list.push(u);
    byFile.set(u.file, list);
  }

  const fileScores = [...byFile].map(([file, fileUsages]) =>
    scoreFile(file, fileUsages, breakingChanges, ctx)
  );

  const high = fileScores.filter((f) => f.riskScore >= TIERS.high).length;
  const medium = fileScores.filter((f) => f.riskScore >= TIERS.medium && f.riskScore < TIERS.high).length;
  const low = fileScores.filter((f) => f.riskScore > 0 && f.riskScore < TIERS.medium).length;

  const topAffectedFiles = fileScores
    .filter((f) => f.riskScore > 0)
    .sort((a, b) => b.riskScore - a.riskScore || a.file.localeCompare(b.file))
    .slice(0, 10)
    .map(({ file, riskScore, reason }) => ({ file, riskScore, reason }));

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
