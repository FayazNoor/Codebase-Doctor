/**
 * Tool: load_migration_requirements
 *
 * Parses migration documentation (from user-provided text or the built-in
 * knowledge base) and maps breaking changes to the repository's actual usages.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertSession,
  readAnalysis,
  writeRequirements,
} from "../lib/session.js";
import type { BreakingChange, MigrationRequirements } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_DIR = path.resolve(__dirname, "../knowledge");

interface Input {
  sessionId: string;
  docsText?: string;
}

export async function loadMigrationRequirements(input: Input): Promise<string> {
  const { sessionId, docsText } = input;

  const session = assertSession(sessionId);
  const { dependency, fromVersion, toVersion } = session.upgrade;

  // Load breaking changes from provided docs text or built-in knowledge base
  const breakingChanges = await parseBreakingChanges(
    dependency,
    fromVersion,
    toVersion,
    docsText
  );

  const analysis = readAnalysis(sessionId);
  const importedSymbols = new Set(
    analysis.dependencyUsages.flatMap((u) =>
      parseImportedSymbols(u.importSpecifier)
    )
  );

  // Filter breaking changes to only those applicable to this repo
  const applicable = breakingChanges.filter((bc) =>
    bc.affectedApis.some((api) => importedSymbols.has(api)) ||
    bc.affectedApis.length === 0
  );

  const requirements: MigrationRequirements = {
    dependency,
    fromVersion,
    toVersion,
    breakingChanges: applicable,
    summary: buildSummary(applicable),
  };

  writeRequirements(sessionId, requirements);

  // Compact output for Bob context
  const auto = applicable.filter((bc) => bc.automatable);
  const manual = applicable.filter((bc) => !bc.automatable);

  return [
    `📋 Migration requirements loaded for ${dependency} ${fromVersion} → ${toVersion}`,
    ``,
    `Found ${applicable.length} applicable breaking changes:`,
    ...applicable.map(
      (bc) =>
        `  [${bc.severity.toUpperCase()}] ${bc.id}: ${bc.description}` +
        (bc.automatable ? " (automatable)" : " (manual)")
    ),
    ``,
    `⚡ Automatable: ${auto.length} | 🔧 Manual: ${manual.length}`,
    ``,
    `Next step: call calculate_migration_blast_radius`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Breaking-change parsers
// ---------------------------------------------------------------------------

async function parseBreakingChanges(
  dependency: string,
  _fromVersion: string,
  _toVersion: string,
  docsText?: string
): Promise<BreakingChange[]> {
  // If docs text provided, use a simple heuristic extraction
  // (In production this would use a more sophisticated NLP approach)
  if (docsText && docsText.length > 100) {
    return extractFromDocsText(docsText, dependency);
  }

  // Fall back to built-in knowledge base
  return loadKnowledgeBase(dependency);
}

function loadKnowledgeBase(dependency: string): BreakingChange[] {
  // Map dependency name to knowledge file
  const knowledgeMap: Record<string, string> = {
    react: "react-17-to-18.json",
    express: "express-4-to-5.json",
  };

  const fileName = knowledgeMap[dependency.toLowerCase()];
  if (!fileName) return [];

  const filePath = path.join(KNOWLEDGE_DIR, fileName);
  if (!fs.existsSync(filePath)) return [];

  return JSON.parse(fs.readFileSync(filePath, "utf8")) as BreakingChange[];
}

function extractFromDocsText(text: string, _dependency: string): BreakingChange[] {
  // Lightweight heuristic: look for common migration doc patterns
  // Real implementation would use more sophisticated extraction
  const changes: BreakingChange[] = [];
  const lines = text.split("\n");

  let currentChange: Partial<BreakingChange> | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Breaking change headers (common patterns in changelogs)
    if (/^#{1,3}\s*(breaking|removed|deprecated|changed)/i.test(trimmed)) {
      if (currentChange?.description) {
        changes.push(finalizeChange(currentChange, changes.length));
      }
      currentChange = {
        description: trimmed.replace(/^#+\s*/, ""),
        affectedApis: [],
        affectedFiles: [],
        automatable: false,
        codemods: [],
        severity: "medium",
      };
    } else if (currentChange && trimmed.startsWith("- ")) {
      // Bullet points are often API names or details
      const api = trimmed.replace(/^-\s*`?([^`]+)`?.*/, "$1").trim();
      if (api.length < 50) {
        currentChange.affectedApis ??= [];
        currentChange.affectedApis.push(api);
      }
    }
  }

  if (currentChange?.description) {
    changes.push(finalizeChange(currentChange, changes.length));
  }

  return changes;
}

function finalizeChange(
  partial: Partial<BreakingChange>,
  index: number
): BreakingChange {
  return {
    id: `docs-${index + 1}`,
    description: partial.description ?? "Unknown change",
    affectedApis: partial.affectedApis ?? [],
    affectedFiles: [],
    automatable: partial.automatable ?? false,
    codemods: partial.codemods ?? [],
    severity: partial.severity ?? "medium",
  };
}

function buildSummary(changes: BreakingChange[]): string {
  const high = changes.filter((c) => c.severity === "high").length;
  const medium = changes.filter((c) => c.severity === "medium").length;
  const low = changes.filter((c) => c.severity === "low").length;
  return `${changes.length} breaking changes (${high} high, ${medium} medium, ${low} low severity)`;
}

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
