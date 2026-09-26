/**
 * Tool: generate_report
 *
 * Produces the before/after migration report from persisted session data
 * only. Markdown (PR body) and HTML (Bob's create_html_artifact) are rendered
 * from the same ReportData, which separates:
 *
 *   measured    — read from session files / git (checks, step statuses, diff)
 *   estimated   — heuristic calculations, always labelled as estimates
 *   unavailable — metrics the server cannot measure (Bobcoin usage, accuracy)
 */

import {
  assertSession,
  readAnalysis,
  readRequirements,
  readPlan,
  readChecksIfExists,
} from "../lib/session.js";
import { blastRadiusLabel } from "../lib/risk.js";
import { changedFiles, headCommit } from "../lib/git.js";
import { projectUrl } from "../lib/project.js";
import type { BlastRadiusReport, CheckStatus, ChecksResult, MigrationStep, StepStatus } from "../types.js";

interface Input {
  sessionId: string;
  format: "markdown" | "html";
}

/** Manual-effort heuristic: minutes per affected file. Labelled as an estimate. */
export const MANUAL_MINUTES_PER_AFFECTED_FILE = 30;

export const STATUS_LABEL: Record<StepStatus, string> = {
  applied: "✅ Automatically fixed",
  completed_manual: "✍️ Manually fixed / reviewed",
  manual_required: "⚠️ Still requires manual action",
  not_applicable: "➖ Not applicable",
  pending: "⏳ Not started",
};

export interface ReportData {
  dependency: string;
  fromVersion: string;
  toVersion: string;
  repo: string;
  branch: string;
  planId: string;
  approval: { approved: boolean; approvedAt: string | null };
  measured: {
    elapsedMinutes: number;
    filesChanged: string[] | null;
    stepCounts: Record<StepStatus, number>;
    totalSteps: number;
    blastRadius: BlastRadiusReport | null;
    checks: ChecksResult | null;
    /** Checks ran on an older commit than the current HEAD. */
    checksStale: boolean;
  };
  estimated: {
    manualEffortHours: number;
    basis: string;
    timeSavedHours: number;
  };
  unavailable: string[];
  breakingChanges: Array<{
    id: string;
    severity: string;
    description: string;
    status: StepStatus;
    files: string[];
    note: string;
  }>;
  steps: MigrationStep[];
  projectUrl: string;
}

export async function generateReport(input: Input): Promise<string> {
  const data = buildReportData(input.sessionId);
  return input.format === "html" ? renderHtml(data) : renderMarkdown(data);
}

export function buildReportData(sessionId: string): ReportData {
  const session = assertSession(sessionId);
  const analysis = readAnalysis(sessionId);
  const requirements = readRequirements(sessionId);
  const plan = readPlan(sessionId);
  const checks = readChecksIfExists(sessionId);

  const { dependency, fromVersion, toVersion } = session.upgrade;
  const localPath = session.repo.localPath;

  const head = safe(() => headCommit(localPath), null);
  const filesChanged = session.baseCommit ? safe(() => changedFiles(localPath, session.baseCommit!), null) : null;

  const stepCounts: Record<StepStatus, number> = {
    pending: 0, applied: 0, manual_required: 0, completed_manual: 0, not_applicable: 0,
  };
  for (const s of plan.steps) stepCounts[s.status]++;

  const elapsedMinutes = Math.max(0, Math.round((Date.now() - new Date(session.createdAt).getTime()) / 60_000));
  const affected = analysis.blastRadius?.affectedFiles ?? 0;
  const manualEffortHours = Math.round(((affected * MANUAL_MINUTES_PER_AFFECTED_FILE) / 60) * 10) / 10;

  const breakingChanges = requirements.breakingChanges.map((bc) => {
    const step = plan.steps.find((s) => s.breakingChangeId === bc.id);
    return {
      id: bc.id,
      severity: bc.severity,
      description: bc.description,
      status: step?.status ?? ("pending" as StepStatus),
      files: step?.files ?? [],
      note: step?.outcome?.note ?? "",
    };
  });

  return {
    dependency,
    fromVersion,
    toVersion,
    repo: `${session.repo.owner}/${session.repo.name}`,
    branch: session.migrationBranch,
    planId: plan.planId,
    approval: { approved: plan.approval.approved, approvedAt: plan.approval.approvedAt },
    measured: {
      elapsedMinutes,
      filesChanged,
      stepCounts,
      totalSteps: plan.steps.length,
      blastRadius: analysis.blastRadius,
      checks,
      checksStale: Boolean(checks && head && checks.headCommit && checks.headCommit !== head),
    },
    estimated: {
      manualEffortHours,
      basis: `${affected} affected files × ${MANUAL_MINUTES_PER_AFFECTED_FILE} min/file (heuristic, not benchmarked)`,
      timeSavedHours: Math.max(0, Math.round((manualEffortHours - elapsedMinutes / 60) * 10) / 10),
    },
    unavailable: [
      "Bobcoin consumption — not measured (not exposed to the MCP server)",
      "Accuracy — not measured (no ground-truth benchmark)",
    ],
    breakingChanges,
    steps: plan.steps,
    projectUrl: projectUrl(),
  };
}

// ---------------------------------------------------------------------------
// Shared formatting
// ---------------------------------------------------------------------------

function checkLabel(status: CheckStatus | undefined): string {
  if (!status) return "NOT RUN";
  return { passed: "PASS", failed: "FAIL", skipped: "SKIPPED" }[status];
}

function verificationLine(r: ReportData): string {
  const c = r.measured.checks;
  if (!c) return "Verification has not been run.";
  const when = `iteration ${c.iteration}, ${c.timestamp}, commit ${c.headCommit?.slice(0, 7) ?? "n/a"}`;
  const stale = r.measured.checksStale ? " — ⚠️ STALE: commits were added after verification; re-run verify_migration" : "";
  return `${c.allPassed ? "✅ PASSED" : "❌ FAILED"} (${when})${stale}`;
}

// ---------------------------------------------------------------------------
// Markdown renderer
// ---------------------------------------------------------------------------

export function renderMarkdown(r: ReportData): string {
  const m = r.measured;
  const c = m.checks;
  const lines: string[] = [
    `## Migration Report: ${r.dependency} ${r.fromVersion} → ${r.toVersion}`,
    ``,
    `Repository: \`${r.repo}\` · Branch: \`${r.branch}\` · Plan \`${r.planId}\` ` +
      (r.approval.approved ? `approved at ${r.approval.approvedAt}` : `**not approved**`),
    ``,
    `### Verification (measured)`,
    ``,
    verificationLine(r),
    ``,
    `| Check | Result | Command |`,
    `|---|---|---|`,
    `| Dependencies installed | ${checkLabel(c?.dependencies.status)} | ${c ? Object.entries(c.dependencies.installed).map(([n, v]) => `${n}@${v ?? "missing"}`).join(", ") || "—" : "—"} |`,
    `| Lint | ${checkLabel(c?.lint.status)} | ${c?.lint.command ?? "—"} |`,
    `| Test | ${checkLabel(c?.test.status)} | ${c?.test.command ?? "—"} |`,
    `| Build | ${checkLabel(c?.build.status)} | ${c?.build.command ?? "—"} |`,
    ``,
    `### Measured`,
    ``,
    `| Metric | Value |`,
    `|---|---|`,
    `| Files using ${r.dependency} (package family) | ${m.blastRadius?.totalFiles ?? "not calculated"} |`,
    `| Files with breaking-change evidence | ${m.blastRadius?.affectedFiles ?? "not calculated"} |`,
    `| Files changed on migration branch | ${m.filesChanged ? m.filesChanged.length : "unavailable (branch base not recorded)"} |`,
    `| Steps automatically applied | ${m.stepCounts.applied} / ${m.totalSteps} |`,
    `| Steps manually fixed / reviewed | ${m.stepCounts.completed_manual} |`,
    `| Steps still requiring manual action | ${m.stepCounts.manual_required} |`,
    `| Steps not applicable | ${m.stepCounts.not_applicable} |`,
    `| Steps not started | ${m.stepCounts.pending} |`,
    `| Elapsed session time (wall-clock, session start → this report) | ${m.elapsedMinutes} min |`,
    ``,
    `### Estimated (not measured)`,
    ``,
    `| Metric | Value | Basis |`,
    `|---|---|---|`,
    `| Estimated manual effort | ~${r.estimated.manualEffortHours} h | ${r.estimated.basis} |`,
    `| Estimated time saved | ~${r.estimated.timeSavedHours} h | estimated manual effort − measured elapsed time |`,
    ``,
    `### Not measured`,
    ``,
    ...r.unavailable.map((u) => `- ${u}`),
    ``,
    `### Blast Radius`,
    ``,
    `${m.blastRadius ? blastRadiusLabel(m.blastRadius) : "—"}`,
    ``,
    `| Risk tier | Files |`,
    `|---|---|`,
    `| 🔴 High (≥70) | ${m.blastRadius?.riskDistribution.high ?? 0} |`,
    `| 🟡 Medium (40–69) | ${m.blastRadius?.riskDistribution.medium ?? 0} |`,
    `| 🟢 Low (1–39) | ${m.blastRadius?.riskDistribution.low ?? 0} |`,
    ``,
    `### Breaking Changes`,
    ``,
    `| Status | Severity | Breaking change | Files |`,
    `|---|---|---|---|`,
    ...r.breakingChanges.map(
      (bc) => `| ${STATUS_LABEL[bc.status]} | ${bc.severity.toUpperCase()} | \`${bc.id}\` ${bc.description} | ${bc.files.length} |`
    ),
    ``,
    `### Migration Steps`,
    ``,
    ...r.steps.map(
      (s) => `- [${s.status === "applied" || s.status === "completed_manual" ? "x" : " "}] ${s.title} (${s.changeType}) — ${STATUS_LABEL[s.status]}` +
        (s.outcome?.note ? `\n  - ${s.outcome.note}` : "")
    ),
    ``,
    `---`,
    `Generated by [Codebase Doctor](${r.projectUrl}).`,
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// HTML renderer (used with Bob's create_html_artifact)
// ---------------------------------------------------------------------------

export function renderHtml(r: ReportData): string {
  const m = r.measured;
  const c = m.checks;
  const cls = (s: CheckStatus | undefined) => (s === "passed" ? "ok" : s === "failed" ? "bad" : "muted");
  const checkRow = (name: string, status: CheckStatus | undefined, detail: string) =>
    `<tr><td>${name}</td><td class="${cls(status)}">${checkLabel(status)}</td><td>${escHtml(detail)}</td></tr>`;

  const bcRows = r.breakingChanges
    .map(
      (bc) =>
        `<tr><td>${escHtml(STATUS_LABEL[bc.status])}</td>` +
        `<td><span class="badge badge-${bc.severity}">${bc.severity.toUpperCase()}</span></td>` +
        `<td><code>${escHtml(bc.id)}</code> ${escHtml(bc.description)}` +
        (bc.note ? `<div class="note">${escHtml(bc.note)}</div>` : "") +
        `</td><td>${bc.files.length}</td></tr>`
    )
    .join("\n");

  const card = (value: string, label: string) =>
    `<div class="metric-card"><div class="metric-value">${escHtml(value)}</div><div class="metric-label">${escHtml(label)}</div></div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Codebase Doctor Report: ${escHtml(r.dependency)} ${escHtml(r.fromVersion)} → ${escHtml(r.toVersion)}</title>
<style>
  body { font-family: -apple-system,"Segoe UI",system-ui,sans-serif; max-width:820px; margin:40px auto; padding:0 20px; color:#1f2328; line-height:1.6; }
  h1 { font-size:1.4rem; border-bottom:1px solid #e5e7eb; padding-bottom:8px; }
  h2 { font-size:1.1rem; margin-top:28px; color:#1f2328; }
  table { width:100%; border-collapse:collapse; font-size:0.9rem; }
  th { background:#f7f8fa; text-align:left; padding:8px 10px; border:1px solid #e5e7eb; }
  td { padding:7px 10px; border:1px solid #e5e7eb; vertical-align:top; }
  .metric-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin:16px 0; }
  .metric-card { background:#f7f8fa; border:1px solid #e5e7eb; border-radius:6px; padding:12px 14px; }
  .metric-value { font-size:1.6rem; font-weight:700; color:#3b82d4; }
  .metric-label { font-size:0.8rem; color:#57606a; margin-top:2px; }
  .badge { display:inline-block; padding:2px 7px; border-radius:12px; font-size:0.75rem; font-weight:600; }
  .badge-high { background:#fee2e2; color:#991b1b; }
  .badge-medium { background:#fef9c3; color:#854d0e; }
  .badge-low { background:#dcfce7; color:#166534; }
  .ok { color:#166534; font-weight:600; } .bad { color:#991b1b; font-weight:600; } .muted { color:#57606a; }
  .note { font-size:0.8rem; color:#57606a; margin-top:4px; }
  .caveat { font-size:0.85rem; color:#57606a; }
  footer { margin-top:40px; padding-top:12px; border-top:1px solid #e5e7eb; text-align:center; font-size:12px; color:#57606a; }
</style>
</head>
<body>
<h1>🩺 Codebase Doctor — Migration Report</h1>
<p><strong>${escHtml(r.dependency)}</strong> ${escHtml(r.fromVersion)} → ${escHtml(r.toVersion)} · <code>${escHtml(r.repo)}</code> · branch <code>${escHtml(r.branch)}</code><br>
Plan <code>${escHtml(r.planId)}</code> — ${r.approval.approved ? `approved at ${escHtml(r.approval.approvedAt ?? "")}` : "<strong>not approved</strong>"}</p>

<h2>Verification (measured)</h2>
<p>${escHtml(verificationLine(r))}</p>
<table>
  <tr><th>Check</th><th>Result</th><th>Detail</th></tr>
  ${checkRow("Dependencies installed", c?.dependencies.status, c ? Object.entries(c.dependencies.installed).map(([n, v]) => `${n}@${v ?? "missing"}`).join(", ") : "—")}
  ${checkRow("Lint", c?.lint.status, c?.lint.command ?? "—")}
  ${checkRow("Test", c?.test.status, c?.test.command ?? "—")}
  ${checkRow("Build", c?.build.status, c?.build.command ?? "—")}
</table>

<h2>Measured</h2>
<div class="metric-grid">
  ${card(String(m.blastRadius?.affectedFiles ?? "—"), "Files with breaking-change evidence")}
  ${card(m.filesChanged ? String(m.filesChanged.length) : "n/a", "Files changed on branch")}
  ${card(`${m.stepCounts.applied}/${m.totalSteps}`, "Steps automatically applied")}
  ${card(String(m.stepCounts.completed_manual), "Steps manually fixed / reviewed")}
  ${card(String(m.stepCounts.manual_required), "Steps still requiring manual action")}
  ${card(`${m.elapsedMinutes}m`, "Elapsed session time (wall-clock)")}
</div>

<h2>Estimated (not measured)</h2>
<table>
  <tr><th>Metric</th><th>Value</th><th>Basis</th></tr>
  <tr><td>Estimated manual effort</td><td>~${r.estimated.manualEffortHours} h</td><td>${escHtml(r.estimated.basis)}</td></tr>
  <tr><td>Estimated time saved</td><td>~${r.estimated.timeSavedHours} h</td><td>estimated manual effort − measured elapsed time</td></tr>
</table>
<p class="caveat">Not measured: ${r.unavailable.map(escHtml).join("; ")}.</p>

<h2>Blast Radius</h2>
<p>${escHtml(m.blastRadius ? blastRadiusLabel(m.blastRadius) : "—")}</p>
<table>
  <tr><th>Risk tier</th><th>Files</th></tr>
  <tr><td>🔴 High (≥70)</td><td>${m.blastRadius?.riskDistribution.high ?? 0}</td></tr>
  <tr><td>🟡 Medium (40–69)</td><td>${m.blastRadius?.riskDistribution.medium ?? 0}</td></tr>
  <tr><td>🟢 Low (1–39)</td><td>${m.blastRadius?.riskDistribution.low ?? 0}</td></tr>
</table>

<h2>Breaking Changes</h2>
<table>
  <tr><th>Status</th><th>Severity</th><th>Breaking change</th><th>Files</th></tr>
  ${bcRows}
</table>

<footer>Generated by <a href="${escHtml(r.projectUrl)}">Codebase Doctor</a> · Made with IBM Bob</footer>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
