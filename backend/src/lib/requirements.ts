/**
 * Migration requirements — canonical knowledge base + user-supplied docs.
 *
 * Built-in structured knowledge is the canonical rule set for supported
 * migrations (e.g. React 17 → 18). Its IDs (react-bc-1 …) are what the
 * automated transforms are keyed on, so they must survive whatever docs the
 * user supplies.
 *
 * User docs AUGMENT and VALIDATE the canonical rules:
 *  - each canonical rule is marked docsConfirmed true/false depending on
 *    whether the docs mention it (rules are never dropped for being absent —
 *    docs are often partial);
 *  - docs sections that match no canonical rule become `docs-N` rules that are
 *    always manual (no automated transform is ever attached to them).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveEcosystem, selectKnowledgeBase, parseMajor } from "./ecosystem.js";
import { matchBreakingChanges } from "./risk.js";
import type { BreakingChange, DependencyUsage, MigrationRequirements } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_DIR = path.resolve(__dirname, "../knowledge");

export interface BuildRequirementsInput {
  dependency: string;
  fromVersion: string;
  toVersion: string;
  usages: DependencyUsage[];
  docsText?: string;
}

export function buildRequirements(input: BuildRequirementsInput): MigrationRequirements {
  const { dependency, fromVersion, toVersion, usages } = input;
  const eco = resolveEcosystem(dependency);
  const kb = selectKnowledgeBase(eco, fromVersion, toVersion);
  const warnings: string[] = [];

  let rules: BreakingChange[] = kb ? loadKnowledgeFile(kb.file) : [];
  rules = rules.map((r) => ({ ...r, source: "knowledge-base" as const }));

  if (!kb) {
    warnings.push(
      `No built-in rules for ${dependency} ${fromVersion} → ${toVersion}; only user-supplied docs are used (all manual).`
    );
  } else {
    const fromMajor = parseMajor(fromVersion);
    if (fromMajor !== null && fromMajor < kb.fromMajor) {
      warnings.push(
        `Repo is on ${dependency} ${fromVersion}; built-in rules cover ${kb.fromMajor} → ${kb.toMajor} only — ` +
          `changes introduced before ${kb.fromMajor}.x are not checked.`
      );
    }
  }

  const docs = input.docsText?.trim() ?? "";
  const docsSupplied = docs.length > 0;
  if (docsSupplied) {
    rules = mergeDocs(rules, docs);
  }

  const applicable = rules.filter((bc) => isApplicable(bc, usages));

  return {
    dependency,
    fromVersion,
    toVersion,
    breakingChanges: applicable,
    summary: buildSummary(applicable),
    knowledgeBase: kb?.file ?? null,
    docsSupplied,
    warnings,
  };
}

/**
 * A rule applies when the repo contains concrete evidence for it. Docs-only
 * rules without any extractable API are kept as manual review items, because
 * the user explicitly supplied them.
 */
export function isApplicable(bc: BreakingChange, usages: DependencyUsage[]): boolean {
  const hasMatcher = (bc.detect?.length ?? 0) > 0 || bc.affectedApis.length > 0;
  if (!hasMatcher) return bc.source === "docs";
  return usages.some((u) => matchBreakingChanges(u, [bc]).length > 0);
}

// ---------------------------------------------------------------------------
// Knowledge base
// ---------------------------------------------------------------------------

export function loadKnowledgeFile(fileName: string): BreakingChange[] {
  const filePath = path.join(KNOWLEDGE_DIR, fileName);
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as BreakingChange[];
}

// ---------------------------------------------------------------------------
// Docs parsing
// ---------------------------------------------------------------------------

interface DocsSection {
  title: string;
  body: string;
  apis: string[];
}

const BREAKING_HEADING = /(breaking|removed|deprecat|changed|no longer)/i;

/**
 * Split docs into sections at Markdown headings whose title signals a
 * breaking change. Plain-text PDF extracts usually have no Markdown headings;
 * for those, only the canonical-rule validation (keyword search over the whole
 * text) applies, and no docs-only rules are invented.
 */
export function parseDocsSections(text: string): DocsSection[] {
  const sections: DocsSection[] = [];
  let current: DocsSection | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const heading = line.match(/^#{1,4}\s+(.+)$/);
    if (heading) {
      if (current) sections.push(current);
      current = BREAKING_HEADING.test(heading[1]) ? { title: heading[1].trim(), body: "", apis: [] } : null;
      continue;
    }
    if (!current) continue;
    current.body += line + "\n";
    const bullet = line.match(/^[-*]\s+`([^`]+)`/);
    if (bullet && bullet[1].length < 50) current.apis.push(bullet[1].replace(/\(\)$/, ""));
  }
  if (current) sections.push(current);
  return sections;
}

function normalise(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ");
}

function mentions(text: string, bc: BreakingChange): boolean {
  const t = normalise(text);
  return (bc.docsKeywords ?? []).some((k) => t.includes(normalise(k)));
}

function mergeDocs(canonical: BreakingChange[], docs: string): BreakingChange[] {
  const validated = canonical.map((bc) => ({ ...bc, docsConfirmed: mentions(docs, bc) }));

  const docsOnly: BreakingChange[] = [];
  for (const section of parseDocsSections(docs)) {
    const sectionText = `${section.title}\n${section.body}`;
    if (canonical.some((bc) => mentions(sectionText, bc))) continue; // enriches a canonical rule
    docsOnly.push({
      id: `docs-${docsOnly.length + 1}`,
      description: section.title.slice(0, 200),
      affectedApis: section.apis,
      affectedFiles: [],
      // Never automatable: no transform is known for an unrecognised rule.
      automatable: false,
      codemods: [],
      severity: "medium",
      resolution: "review",
      source: "docs",
      manualAction: `From the supplied migration docs: "${section.title.slice(0, 120)}". Review and apply manually.`,
    });
  }
  return [...validated, ...docsOnly];
}

function buildSummary(changes: BreakingChange[]): string {
  const high = changes.filter((c) => c.severity === "high").length;
  const medium = changes.filter((c) => c.severity === "medium").length;
  const low = changes.filter((c) => c.severity === "low").length;
  return `${changes.length} breaking changes (${high} high, ${medium} medium, ${low} low severity)`;
}
