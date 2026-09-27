/**
 * Tool: generate_report
 *
 * Produces the migration report from persisted session data only, at any
 * stage of the workflow (right after analysis, while the plan awaits
 * approval, mid-implementation, after verification, after the PR).
 * Markdown (PR body) and HTML (Bob's create_html_artifact) are rendered from
 * the same ReportData, which separates:
 *
 *   measured    — read from session files / git (checks, step statuses, diffs)
 *   estimated   — heuristic calculations, always labelled as estimates
 *   unavailable — metrics the server cannot measure (Bobcoin usage, accuracy)
 *
 * Every state file is integrity-checked (lib/integrity.ts): a verification
 * result that was not written by verify_migration is reported as untrusted,
 * never as PASSED.
 */

import {
  assertSession,
  readAnalysis,
  readRequirementsIfExists,
  readPlanIfExists,
  readChecksIfExists,
  readChecksHistory,
} from "../lib/session.js";
import { blastRadiusLabel, TIERS } from "../lib/risk.js";
import { changedFiles, headCommit, commitStat, commitDiff, uncommittedFiles } from "../lib/git.js";
import { isTestFile } from "../lib/ast.js";
import { projectUrl } from "../lib/project.js";
import { renderHtml } from "../lib/report-html.js";
import type {
  BlastRadiusReport,
  CheckStatus,
  ChecksResult,
  ChecksHistoryEntry,
  CompatReport,
  DependencyUsage,
  MigrationStep,
  StepStatus,
} from "../types.js";

interface Input {
  sessionId: string;
  format: "markdown" | "html";
  /** Markdown for a PR body: the PR itself is the status, so no "next action" line. */
  forPullRequest?: boolean;
}

/** Manual-effort heuristic: minutes per affected file. Labelled as an estimate. */
export const MANUAL_MINUTES_PER_AFFECTED_FILE = 30;

export const STATUS_LABEL: Record<StepStatus, string> = {
  applied: "✅ Automatically fixed",
  completed_manual: "✍️ Manually fixed / reviewed",
  manual_required: "⚠️ Still requires manual action",
  skipped: "⏭️ Skipped by user (still open)",
  failed: "❌ Failed (rolled back)",
  not_applicable: "➖ Not applicable",
  pending: "⏳ Not started",
};

/** Workflow stages shown in the report's progress tracker. */
export const STAGES = ["Analyse", "Rules", "Risk", "Plan", "Approve", "Implement", "Verify", "Pull request"] as const;
export type StageState = "done" | "current" | "todo" | "blocked";

export interface FileEvidence {
  file: string;
  riskScore: number;
  tier: "high" | "medium" | "low" | "none";
  reason: string;
  isTest: boolean;
  usages: Array<{ line: number; kind: "import" | "api"; module: string; api: string | null; snippet: string; rules: string[] }>;
  truncated: number;
}

export interface ChangeSet {
  order: number;
  title: string;
  status: StepStatus;
  commit: string;
  stat: string;
  diff: string;
  diffTruncated: boolean;
}

export interface ReportData {
  generatedAt: string;
  sessionId: string;
  dependency: string;
  fromVersion: string;
  toVersion: string;
  repo: string;
  repoUrl: string | null;
  source: "github" | "local";
  branch: string;
  defaultBranch: string;
  stages: Array<{ name: string; state: StageState }>;
  headline: { label: string; tone: "ok" | "bad" | "warn" | "info" };
  nextAction: string;
  analysis: {
    language: string;
    packageManager: string;
    testFramework: string | null;
    commands: { lint: string | null; test: string | null; build: string | null };
    filesScanned: number | null;
    familyFiles: number;
    imports: number;
    apiUsages: number;
    warnings: string[];
  };
  compat: CompatReport | null;
  requirements: { knowledgeBase: string | null; docsSupplied: boolean; warnings: string[] } | null;
  planId: string | null;
  estimatedEffort: string | null;
  approval: { approved: boolean; approvedAt: string | null };
  measured: {
    elapsedMinutes: number;
    filesChanged: string[] | null;
    stepCounts: Record<StepStatus, number>;
    totalSteps: number;
    blastRadius: BlastRadiusReport | null;
    checks: ChecksResult | null;
    /** Why a persisted verification result is not shown (e.g. failed integrity check). */
    checksProblem: string | null;
    /** Checks ran on an older commit than the current HEAD. */
    checksStale: boolean;
    uncommitted: string[];
    /** Every verify_migration run (oldest first). */
    history: ChecksHistoryEntry[];
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
    automatable: boolean;
    source: string;
    docsConfirmed: boolean | undefined;
    files: string[];
    note: string;
    manualAction: string | null;
  }>;
  steps: MigrationStep[];
  files: FileEvidence[];
  changes: ChangeSet[];
  remaining: Array<{ id: string; title: string; status: StepStatus; action: string }>;
  pullRequest: { url: string; number: number } | null;
  projectUrl: string;
}

export async function generateReport(input: Input): Promise<string> {
  const data = buildReportData(input.sessionId);
  return input.format === "html" ? renderHtml(data) : renderMarkdown(data, { forPullRequest: input.forPullRequest });
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const MAX_FILES = 200;
const MAX_USAGES_PER_FILE = 25;
const MAX_DIFF_LINES_PER_COMMIT = 400;
const LOCKFILE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|npm-shrinkwrap\.json)$/;

export function buildReportData(sessionId: string): ReportData {
  const session = assertSession(sessionId);
  const analysis = readAnalysis(sessionId);
  const requirements = readRequirementsIfExists(sessionId);
  const plan = readPlanIfExists(sessionId);
  let checks: ChecksResult | null = null;
  let checksProblem: string | null = null;
  try {
    checks = readChecksIfExists(sessionId);
  } catch (err) {
    checksProblem = (err as Error).message;
  }

  const { dependency, fromVersion, toVersion } = session.upgrade;
  const localPath = session.repo.localPath;

  const head = safe(() => headCommit(localPath), null);
  const uncommitted = safe(() => uncommittedFiles(localPath), [] as string[]);
  const filesChanged = session.baseCommit ? safe(() => changedFiles(localPath, session.baseCommit!), null) : null;
  const steps = plan?.steps ?? [];

  const stepCounts: Record<StepStatus, number> = {
    pending: 0, applied: 0, manual_required: 0, completed_manual: 0, skipped: 0, failed: 0, not_applicable: 0,
  };
  for (const s of steps) stepCounts[s.status]++;

  const elapsedMinutes = Math.max(0, Math.round((Date.now() - new Date(session.createdAt).getTime()) / 60_000));
  const affected = analysis.blastRadius?.affectedFiles ?? 0;
  const manualEffortHours = Math.round(((affected * MANUAL_MINUTES_PER_AFFECTED_FILE) / 60) * 10) / 10;
  const checksStale = Boolean(checks && head && checks.headCommit && checks.headCommit !== head);

  const breakingChanges = (plan?.breakingChanges ?? requirements?.breakingChanges ?? []).map((bc) => {
    const step = steps.find((s) => s.breakingChangeId === bc.id);
    const files =
      step?.files ??
      [...new Set(analysis.dependencyUsages.filter((u) => u.breakingChangeIds.includes(bc.id)).map((u) => u.file))].sort();
    return {
      id: bc.id,
      severity: bc.severity,
      description: bc.description,
      status: step?.status ?? ("pending" as StepStatus),
      automatable: step?.automatable ?? bc.automatable,
      source: bc.source ?? "knowledge-base",
      docsConfirmed: bc.docsConfirmed,
      files,
      note: step?.outcome?.note ?? "",
      manualAction: bc.manualAction ?? null,
    };
  });

  const familyFiles = new Set(analysis.dependencyUsages.map((u) => u.file));
  const imports = analysis.dependencyUsages.filter((u) => u.kind === "import").length;

  const { stages, headline, nextAction } = describeProgress({
    requirements: requirements !== null,
    blastRadius: analysis.blastRadius !== null,
    plan: plan !== null,
    approved: Boolean(plan?.approval.approved),
    onBranch: Boolean(session.baseCommit),
    steps,
    checks,
    checksProblem,
    checksStale,
    uncommitted,
    pr: session.pullRequest ?? null,
    local: !session.repo.owner,
  });

  return {
    generatedAt: new Date().toISOString(),
    sessionId,
    dependency,
    fromVersion,
    toVersion,
    repo: session.repo.owner ? `${session.repo.owner}/${session.repo.name}` : `${session.repo.name} (local)`,
    repoUrl: session.repo.owner ? `https://github.com/${session.repo.owner}/${session.repo.name}` : null,
    source: session.repo.source ?? "github",
    branch: session.migrationBranch,
    defaultBranch: session.repo.defaultBranch,
    stages,
    headline,
    nextAction,
    analysis: {
      language: analysis.repoLanguage,
      packageManager: analysis.packageManager,
      testFramework: analysis.testFramework,
      commands: { lint: analysis.lintCommand, test: analysis.testCommand, build: analysis.buildCommand },
      filesScanned: analysis.filesScanned ?? null,
      familyFiles: familyFiles.size,
      imports,
      apiUsages: analysis.dependencyUsages.length - imports,
      warnings: analysis.warnings ?? [],
    },
    compat: analysis.compat ?? null,
    requirements: requirements
      ? { knowledgeBase: requirements.knowledgeBase, docsSupplied: requirements.docsSupplied, warnings: requirements.warnings }
      : null,
    planId: plan?.planId ?? null,
    estimatedEffort: plan?.estimatedEffort ?? null,
    approval: { approved: Boolean(plan?.approval.approved), approvedAt: plan?.approval.approvedAt ?? null },
    measured: {
      elapsedMinutes,
      filesChanged,
      stepCounts,
      totalSteps: steps.length,
      blastRadius: analysis.blastRadius,
      checks,
      checksProblem,
      checksStale,
      uncommitted,
      history: safe(() => readChecksHistory(sessionId), [] as ChecksHistoryEntry[]),
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
    steps,
    files: buildFileEvidence(analysis.dependencyUsages, analysis.blastRadius),
    changes: buildChangeSets(localPath, steps),
    remaining: steps
      .filter((s) => ["manual_required", "skipped", "failed", "pending"].includes(s.status))
      .map((s) => ({
        id: s.id,
        title: s.title,
        status: s.status,
        action:
          s.status === "failed"
            ? `Retry: ${s.outcome?.note ?? ""}`
            : s.outcome?.residual?.length
              ? `Still found: ${s.outcome.residual.slice(0, 3).join("; ")}. ${manualActionOf(s)}`
              : manualActionOf(s) || s.outcome?.note || "Run this step.",
      })),
    pullRequest: session.pullRequest ? { url: session.pullRequest.url, number: session.pullRequest.number } : null,
    projectUrl: projectUrl(),
  };
}

function manualActionOf(step: MigrationStep): string {
  const line = step.description.split("\n").find((l) => l.startsWith("⚠️ Manual action required:"));
  return line ? line.replace("⚠️ Manual action required: ", "") : step.changeType === "test" ? step.description : "";
}

function buildFileEvidence(usages: DependencyUsage[], blastRadius: BlastRadiusReport | null): FileEvidence[] {
  const scored = blastRadius !== null;
  // The scorer's own breakdown ("react-bc-1 +40, root bootstrap +30") for the top files.
  const reasons = new Map((blastRadius?.topAffectedFiles ?? []).map((f) => [f.file, f.reason]));
  const byFile = new Map<string, DependencyUsage[]>();
  for (const u of usages) byFile.set(u.file, [...(byFile.get(u.file) ?? []), u]);
  const tier = (s: number): FileEvidence["tier"] => (s >= TIERS.high ? "high" : s >= TIERS.medium ? "medium" : s > 0 ? "low" : "none");
  return [...byFile.entries()]
    .map(([file, list]) => {
      const score = scored ? Math.max(0, ...list.map((u) => u.riskScore)) : 0;
      const rules = [...new Set(list.flatMap((u) => u.breakingChangeIds))].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
      const sorted = [...list].sort((a, b) => a.line - b.line);
      return {
        file,
        riskScore: score,
        tier: tier(score),
        reason: reasons.get(file) ?? (rules.length > 0 ? rules.join(", ") : scored ? "stable APIs only" : "not scored yet"),
        isTest: isTestFile(file),
        usages: sorted.slice(0, MAX_USAGES_PER_FILE).map((u) => ({
          line: u.line,
          kind: u.kind,
          module: u.module,
          api: u.api,
          snippet: u.usageContext,
          rules: u.breakingChangeIds,
        })),
        truncated: Math.max(0, sorted.length - MAX_USAGES_PER_FILE),
      };
    })
    .sort((a, b) => b.riskScore - a.riskScore || a.file.localeCompare(b.file))
    .slice(0, MAX_FILES);
}

function buildChangeSets(localPath: string, steps: MigrationStep[]): ChangeSet[] {
  const out: ChangeSet[] = [];
  for (const s of steps) {
    const sha = s.outcome?.commit;
    if (!sha) continue;
    const stat = safe(() => commitStat(localPath, sha), "");
    const raw = safe(() => commitDiff(localPath, sha), "");
    const { diff, truncated } = trimDiff(raw);
    out.push({ order: s.order, title: s.title, status: s.status, commit: sha, stat, diff, diffTruncated: truncated });
  }
  return out;
}

/** Drop lockfile hunks (summarised instead) and cap the diff length. */
export function trimDiff(raw: string): { diff: string; truncated: boolean } {
  const chunks = raw.split(/^(?=diff --git )/m).filter(Boolean);
  const kept: string[] = [];
  for (const chunk of chunks) {
    const file = chunk.match(/^diff --git a\/(\S+)/)?.[1] ?? "";
    if (LOCKFILE.test(file)) {
      const added = (chunk.match(/^\+(?!\+\+)/gm) ?? []).length;
      const removed = (chunk.match(/^-(?!--)/gm) ?? []).length;
      kept.push(`diff --git a/${file} b/${file}\n@@ lockfile diff omitted: +${added} −${removed} lines @@\n`);
    } else {
      kept.push(chunk);
    }
  }
  const lines = kept.join("").split("\n");
  if (lines.length <= MAX_DIFF_LINES_PER_COMMIT) return { diff: lines.join("\n"), truncated: false };
  return { diff: lines.slice(0, MAX_DIFF_LINES_PER_COMMIT).join("\n"), truncated: true };
}

interface ProgressInput {
  requirements: boolean;
  blastRadius: boolean;
  plan: boolean;
  approved: boolean;
  onBranch: boolean;
  steps: MigrationStep[];
  checks: ChecksResult | null;
  checksProblem: string | null;
  checksStale: boolean;
  uncommitted: string[];
  pr: { url: string } | null;
  local: boolean;
}

/** Stage tracker, headline and the one next action — all derived from persisted state. */
export function describeProgress(p: ProgressInput): Pick<ReportData, "stages" | "headline" | "nextAction"> {
  const executed = p.steps.length > 0 && p.steps.every((s) => s.status !== "pending" && s.status !== "failed");
  const anyFailed = p.steps.some((s) => s.status === "failed");
  const verified = Boolean(p.checks?.allPassed) && !p.checksStale && (p.checks?.uncommittedFiles ?? []).length === 0 && p.uncommitted.length === 0;
  const verifyFailed = Boolean(p.checks && !p.checks.allPassed && !p.checksStale);

  const done = [true, p.requirements, p.blastRadius, p.plan, p.approved, executed, verified, Boolean(p.pr)];
  const firstOpen = done.findIndex((d) => !d);
  const stages = STAGES.map((name, i) => {
    let state: StageState = done[i] ? "done" : i === firstOpen ? "current" : "todo";
    if (i === firstOpen && ((name === "Implement" && anyFailed) || (name === "Verify" && (verifyFailed || p.checksProblem)))) state = "blocked";
    return { name, state };
  });

  let headline: ReportData["headline"];
  let nextAction: string;
  if (p.pr) {
    headline = { label: "Pull request open", tone: "ok" };
    nextAction = `Review and merge the pull request: ${p.pr.url}`;
  } else if (!p.requirements) {
    headline = { label: "Analysed", tone: "info" };
    nextAction = "Load the migration rules (load_migration_requirements), optionally with the migration guide text.";
  } else if (!p.blastRadius) {
    headline = { label: "Rules loaded", tone: "info" };
    nextAction = "Score the blast radius (calculate_migration_blast_radius).";
  } else if (!p.plan) {
    headline = { label: "Risk scored", tone: "info" };
    nextAction = "Generate the migration plan (generate_migration_plan).";
  } else if (!p.approved) {
    headline = { label: "Awaiting approval", tone: "warn" };
    nextAction = 'Review the plan below and reply "approved" in Bob — nothing in the repository changes until then.';
  } else if (!p.onBranch) {
    headline = { label: "Approved", tone: "info" };
    nextAction = "Create the migration branch (checkout_branch), then apply each step.";
  } else if (anyFailed) {
    const f = p.steps.find((s) => s.status === "failed")!;
    headline = { label: "Step failed", tone: "bad" };
    nextAction = `Fix the cause and retry step ${f.order} (${f.id}): ${f.outcome?.note ?? ""}`;
  } else if (!executed) {
    const next = p.steps.find((s) => s.status === "pending")!;
    headline = { label: "Implementing", tone: "info" };
    nextAction = `Apply step ${next.order} (${next.id}).`;
  } else if (p.checksProblem) {
    headline = { label: "Verification untrusted", tone: "bad" };
    nextAction = "The stored verification result failed its integrity check. Run verify_migration again.";
  } else if (!p.checks || p.checksStale) {
    headline = { label: p.checksStale ? "Verification stale" : "Ready to verify", tone: p.checksStale ? "warn" : "info" };
    nextAction = "Run verify_migration against the current commit.";
  } else if (!p.checks.allPassed) {
    headline = { label: "Verification failed", tone: "bad" };
    nextAction = "Fix the failures listed under Verification, record the fix on its step, and verify again (max 3 iterations).";
  } else if (!verified) {
    headline = { label: "Uncommitted changes", tone: "warn" };
    nextAction = "Commit the working-tree changes through apply_migration_patch (markManualComplete + note) and verify again.";
  } else if (p.local) {
    headline = { label: "Verified", tone: "ok" };
    nextAction = "Verification passed. This is a local repository without a GitHub remote — push the branch yourself to open a PR.";
  } else {
    headline = { label: "Ready for pull request", tone: "ok" };
    nextAction = "Verification passed on HEAD — open the pull request (create_pull_request).";
  }
  return { stages, headline, nextAction };
}

// ---------------------------------------------------------------------------
// Shared formatting
// ---------------------------------------------------------------------------

export function checkLabel(status: CheckStatus | undefined): string {
  if (!status) return "NOT RUN";
  return { passed: "PASS", failed: "FAIL", skipped: "SKIPPED" }[status];
}

export function verificationLine(r: ReportData): string {
  if (r.measured.checksProblem) return "⚠️ UNTRUSTED — the stored verification result failed its integrity check; it is not reported.";
  const c = r.measured.checks;
  if (!c) return "Verification has not been run.";
  const when = `iteration ${c.iteration}, ${c.timestamp}, commit ${c.headCommit?.slice(0, 7) ?? "n/a"}`;
  const stale = r.measured.checksStale ? " — ⚠️ STALE: commits were added after verification; re-run verify_migration" : "";
  const dirty = (c.uncommittedFiles ?? []).length > 0 ? " — ⚠️ ran on uncommitted changes" : "";
  return `${c.allPassed ? "✅ PASSED" : "❌ FAILED"} (${when})${stale}${dirty}`;
}

/** Escape text for a Markdown table cell (pipes, newlines, raw HTML, @-mentions). */
export function mdCell(text: string): string {
  return text
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/@(?=[A-Za-z0-9-])/g, "@​");
}

// ---------------------------------------------------------------------------
// Markdown renderer (PR body)
// ---------------------------------------------------------------------------

export function renderMarkdown(r: ReportData, opts: { forPullRequest?: boolean } = {}): string {
  const m = r.measured;
  const c = m.checks;
  const lines: string[] = [
    `## Migration Report: ${r.dependency} ${r.fromVersion} → ${r.toVersion}`,
    ``,
    `Repository: \`${r.repo}\` · Branch: \`${r.branch}\` · ` +
      (r.planId ? `Plan \`${r.planId}\` ` + (r.approval.approved ? `approved at ${r.approval.approvedAt}` : `**not approved**`) : "No plan yet"),
    ``,
    ...(opts.forPullRequest ? [] : [`**Status:** ${r.headline.label} — ${mdCell(r.nextAction)}`, ``]),
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
  ];

  if (m.history.length > 1) {
    lines.push(
      `Verification history: ` +
        m.history.map((h) => `#${h.iteration} ${h.allPassed ? "passed" : "failed"} on \`${h.headCommit?.slice(0, 7) ?? "n/a"}\``).join(" → "),
      ``
    );
  }

  if (r.remaining.length > 0) {
    lines.push(`### Remaining work`, ``);
    for (const item of r.remaining) {
      lines.push(`- ${STATUS_LABEL[item.status]} — **${mdCell(item.title)}** (\`${item.id}\`): ${mdCell(item.action).slice(0, 400)}`);
    }
    lines.push(``);
  }

  lines.push(
    `### Measured`,
    ``,
    `| Metric | Value |`,
    `|---|---|`,
    `| Files using ${r.dependency} (package family) | ${m.blastRadius?.totalFiles ?? r.analysis.familyFiles} |`,
    `| Files with breaking-change evidence | ${m.blastRadius?.affectedFiles ?? "not calculated"} |`,
    `| Files changed on migration branch | ${m.filesChanged ? m.filesChanged.length : "unavailable (branch not created yet)"} |`,
    `| Steps automatically applied | ${m.stepCounts.applied} / ${m.totalSteps} |`,
    `| Steps manually fixed / reviewed | ${m.stepCounts.completed_manual} |`,
    `| Steps still requiring manual action | ${m.stepCounts.manual_required} |`,
    `| Steps skipped by user | ${m.stepCounts.skipped} |`,
    `| Steps failed | ${m.stepCounts.failed} |`,
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
    ``
  );

  const top = r.files.filter((f) => f.riskScore > 0).slice(0, 10);
  if (top.length > 0) {
    lines.push(`| Top affected file | Score | Evidence |`, `|---|---|---|`);
    for (const f of top) lines.push(`| \`${mdCell(f.file)}\` | ${f.riskScore} | ${mdCell(f.reason)} |`);
    lines.push(``);
  }

  lines.push(
    `### Breaking Changes`,
    ``,
    `| Status | Severity | Breaking change | Files |`,
    `|---|---|---|---|`,
    ...r.breakingChanges.map(
      (bc) => `| ${STATUS_LABEL[bc.status]} | ${bc.severity.toUpperCase()} | \`${mdCell(bc.id)}\` ${mdCell(bc.description)} | ${bc.files.length} |`
    ),
    ``
  );

  const conflicts = r.compat?.conflicts ?? [];
  if (conflicts.length > 0) {
    lines.push(`### Peer-dependency compatibility`, ``, `| Package | Peer range | Resolution |`, `|---|---|---|`);
    for (const k of conflicts) {
      lines.push(
        `| \`${mdCell(k.name)}@${mdCell(k.version)}\` | ${mdCell(`${k.peer} ${k.range}`)} | ${k.autoUpgrade ? `upgraded to ${mdCell(k.suggestion ?? "")} by the dependency step` : k.suggestion ? `manual — try ${mdCell(k.suggestion)}` : "manual"} |`
      );
    }
    lines.push(``);
  }

  if (r.steps.length > 0) {
    lines.push(`### Migration Steps`, ``);
    for (const s of r.steps) {
      lines.push(
        `- [${s.status === "applied" || s.status === "completed_manual" || s.status === "not_applicable" ? "x" : " "}] ${mdCell(s.title)} (${s.changeType}) — ${STATUS_LABEL[s.status]}` +
          (s.outcome?.commit ? ` · \`${s.outcome.commit.slice(0, 7)}\`` : "") +
          (s.outcome?.note ? `\n  - ${mdCell(s.outcome.note).slice(0, 500)}` : "")
      );
    }
    lines.push(``);
  }

  if (r.pullRequest) lines.push(`Pull request: ${r.pullRequest.url}`, ``);
  lines.push(`---`, `Generated by [Codebase Doctor](${r.projectUrl}) from persisted session data (session \`${r.sessionId}\`).`);
  return lines.join("\n");
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
