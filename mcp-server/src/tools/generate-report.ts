/**
 * Tool: generate_report
 *
 * Produces a before/after migration report including blast radius stats,
 * breaking changes addressed, test results, and productivity metrics.
 * Returns Markdown (for PR body) or HTML (for Bob's create_html_artifact).
 */

import {
  assertSession,
  readAnalysis,
  readRequirements,
  readPlan,
} from "../lib/session.js";
import { blastRadiusLabel } from "../lib/risk.js";

interface Input {
  sessionId: string;
  format: "markdown" | "html";
}

export async function generateReport(input: Input): Promise<string> {
  const { sessionId, format } = input;

  const session = assertSession(sessionId);
  const analysis = readAnalysis(sessionId);
  const requirements = readRequirements(sessionId);
  const plan = readPlan(sessionId);

  const { dependency, fromVersion, toVersion } = session.upgrade;
  const blastRadius = analysis.blastRadius;

  // Wall-clock time
  const startTime = new Date(session.createdAt);
  const durationMs = Date.now() - startTime.getTime();
  const durationMin = Math.round(durationMs / 60_000);

  // Productivity estimate
  const affectedFiles = blastRadius?.affectedFiles ?? 0;
  const manualEstimateHours = Math.round(affectedFiles * 0.5);

  const appliedSteps = plan.steps.filter((s) => s.applied).length;
  const totalSteps = plan.steps.length;

  const report = {
    dependency,
    fromVersion,
    toVersion,
    blastRadius,
    breakingChanges: requirements.breakingChanges,
    plan,
    appliedSteps,
    totalSteps,
    durationMin,
    manualEstimateHours,
    affectedFiles,
    label: blastRadius ? blastRadiusLabel(blastRadius) : "—",
  };

  if (format === "html") {
    return renderHtml(report);
  }
  return renderMarkdown(report);
}

// ---------------------------------------------------------------------------
// Markdown renderer
// ---------------------------------------------------------------------------

function renderMarkdown(r: ReturnType<typeof buildReportData>): string {
  const lines: string[] = [
    `## Migration Report: ${r.dependency} ${r.fromVersion} → ${r.toVersion}`,
    ``,
    `### Productivity Metrics`,
    ``,
    `| Metric | Value |`,
    `|---|---|`,
    `| Files affected | ${r.affectedFiles} |`,
    `| Migration steps applied | ${r.appliedSteps} / ${r.totalSteps} |`,
    `| Time taken (Codebase Doctor) | ${r.durationMin} minutes |`,
    `| Estimated manual effort | ~${r.manualEstimateHours} hours |`,
    `| Time saved | ~${Math.max(0, r.manualEstimateHours * 60 - r.durationMin)} minutes |`,
    ``,
    `### Blast Radius`,
    ``,
    `${r.label}`,
    ``,
    `| Risk tier | Files |`,
    `|---|---|`,
    `| 🔴 High | ${r.blastRadius?.riskDistribution.high ?? 0} |`,
    `| 🟡 Medium | ${r.blastRadius?.riskDistribution.medium ?? 0} |`,
    `| 🟢 Low | ${r.blastRadius?.riskDistribution.low ?? 0} |`,
    ``,
    `### Breaking Changes Addressed`,
    ``,
    ...r.breakingChanges.map(
      (bc) => `- [x] **[${bc.severity.toUpperCase()}]** ${bc.description}`
    ),
    ``,
    `### Migration Steps`,
    ``,
    ...r.plan.steps.map(
      (s) => `- [${s.applied ? "x" : " "}] ${s.title} (${s.changeType})`
    ),
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// HTML renderer (used with Bob's create_html_artifact)
// ---------------------------------------------------------------------------

function renderHtml(r: ReturnType<typeof buildReportData>): string {
  const timeSavedMin = Math.max(0, r.manualEstimateHours * 60 - r.durationMin);
  const breakingChangeRows = r.breakingChanges
    .map(
      (bc) =>
        `<tr><td><span class="badge badge-${bc.severity}">${bc.severity.toUpperCase()}</span></td>` +
        `<td>${escHtml(bc.description)}</td>` +
        `<td>${bc.automatable ? "✅" : "🔧"}</td></tr>`
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Codebase Doctor Report: ${escHtml(r.dependency)} ${escHtml(r.fromVersion)} → ${escHtml(r.toVersion)}</title>
<style>
  body { font-family: -apple-system,"Segoe UI",system-ui,sans-serif; max-width:760px; margin:40px auto; padding:0 20px; color:#1f2328; line-height:1.6; }
  h1 { font-size:1.4rem; border-bottom:1px solid #e5e7eb; padding-bottom:8px; }
  h2 { font-size:1.1rem; margin-top:28px; color:#1f2328; }
  table { width:100%; border-collapse:collapse; font-size:0.9rem; }
  th { background:#f7f8fa; text-align:left; padding:8px 10px; border:1px solid #e5e7eb; }
  td { padding:7px 10px; border:1px solid #e5e7eb; }
  .metric-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin:16px 0; }
  .metric-card { background:#f7f8fa; border:1px solid #e5e7eb; border-radius:6px; padding:12px 14px; }
  .metric-value { font-size:1.8rem; font-weight:700; color:#3b82d4; }
  .metric-label { font-size:0.8rem; color:#57606a; margin-top:2px; }
  .badge { display:inline-block; padding:2px 7px; border-radius:12px; font-size:0.75rem; font-weight:600; }
  .badge-high { background:#fee2e2; color:#991b1b; }
  .badge-medium { background:#fef9c3; color:#854d0e; }
  .badge-low { background:#dcfce7; color:#166534; }
  footer { margin-top:40px; padding-top:12px; border-top:1px solid #e5e7eb; text-align:center; font-size:12px; color:#57606a; }
</style>
</head>
<body>
<h1>🩺 Codebase Doctor — Migration Report</h1>
<p><strong>${escHtml(r.dependency)}</strong> ${escHtml(r.fromVersion)} → ${escHtml(r.toVersion)}</p>

<h2>Productivity Metrics</h2>
<div class="metric-grid">
  <div class="metric-card"><div class="metric-value">${r.affectedFiles}</div><div class="metric-label">Files affected</div></div>
  <div class="metric-card"><div class="metric-value">${r.durationMin}m</div><div class="metric-label">Time taken</div></div>
  <div class="metric-card"><div class="metric-value">~${r.manualEstimateHours}h</div><div class="metric-label">Manual estimate</div></div>
  <div class="metric-card"><div class="metric-value">${timeSavedMin}m</div><div class="metric-label">Time saved</div></div>
  <div class="metric-card"><div class="metric-value">${r.appliedSteps}/${r.totalSteps}</div><div class="metric-label">Steps applied</div></div>
</div>

<h2>Blast Radius</h2>
<p>${escHtml(r.label)}</p>
<table>
  <tr><th>Risk tier</th><th>Files</th></tr>
  <tr><td>🔴 High</td><td>${r.blastRadius?.riskDistribution.high ?? 0}</td></tr>
  <tr><td>🟡 Medium</td><td>${r.blastRadius?.riskDistribution.medium ?? 0}</td></tr>
  <tr><td>🟢 Low</td><td>${r.blastRadius?.riskDistribution.low ?? 0}</td></tr>
</table>

<h2>Breaking Changes Addressed</h2>
<table>
  <tr><th>Severity</th><th>Description</th><th>Automated</th></tr>
  ${breakingChangeRows}
</table>

<footer>Made with IBM Bob</footer>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildReportData(r: {
  dependency: string;
  fromVersion: string;
  toVersion: string;
  blastRadius: import("../types.js").BlastRadiusReport | null;
  breakingChanges: import("../types.js").BreakingChange[];
  plan: import("../types.js").MigrationPlan;
  appliedSteps: number;
  totalSteps: number;
  durationMin: number;
  manualEstimateHours: number;
  affectedFiles: number;
  label: string;
}) {
  return r;
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
