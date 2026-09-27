/**
 * HTML renderer for the migration report ("migration dossier").
 *
 * One self-contained page (inline CSS + a small progressive-enhancement
 * script) that Bob renders with create_html_artifact and that also opens
 * directly in a browser. Every value comes from ReportData, which is built
 * from persisted session state — the renderer never invents numbers; missing
 * data is shown as an explicit empty state.
 *
 * Design: warm paper / ink palette with an amber accent and a monospace
 * typographic system; light + dark themes (system default, toggle persisted
 * per viewer); responsive down to 360px; keyboard- and screen-reader-friendly
 * (landmarks, skip link, real headings/tables, details/summary, aria-pressed
 * filters, visible focus, reduced-motion aware).
 */

import type { ReportData, FileEvidence } from "../tools/generate-report.js";
import type { CheckStatus, StepStatus } from "../types.js";

const checkLabel = (status: CheckStatus): string => ({ passed: "PASS", failed: "FAIL", skipped: "SKIPPED" })[status];

// ---------------------------------------------------------------------------
// Escaping helpers
// ---------------------------------------------------------------------------

export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escape, then render `backtick` spans as <code> (for rule guidance and notes). */
function prose(value: unknown): string {
  return esc(value).replace(/`([^`\n]{1,200})`/g, "<code>$1</code>");
}

/** Only http(s) URLs become links; anything else renders as text. */
function safeHref(url: string | null | undefined): string | null {
  return url && /^https?:\/\//i.test(url) ? esc(url) : null;
}

const STATUS_TONE: Record<StepStatus, string> = {
  applied: "ok",
  completed_manual: "ok",
  not_applicable: "muted",
  manual_required: "warn",
  skipped: "warn",
  failed: "bad",
  pending: "muted",
};
const STATUS_SHORT: Record<StepStatus, string> = {
  applied: "Applied automatically",
  completed_manual: "Completed manually",
  manual_required: "Manual action required",
  skipped: "Skipped (open)",
  failed: "Failed — rolled back",
  not_applicable: "Not applicable",
  pending: "Not started",
};
const CHECK_TONE: Record<CheckStatus, string> = { passed: "ok", failed: "bad", skipped: "muted" };

const pill = (tone: string, text: string) => `<span class="pill pill-${tone}">${esc(text)}</span>`;
const short = (sha: string | null | undefined) => (sha ? esc(sha.slice(0, 7)) : "—");
const fmtTime = (iso: string | null | undefined) => (iso ? esc(iso.replace("T", " ").replace(/\.\d+Z$/, " UTC").replace(/Z$/, " UTC")) : "—");

function section(id: string, n: number, label: string, lead: string, body: string): string {
  return `
<section class="section" id="${id}" aria-labelledby="${id}-h">
  <p class="label"><span class="num">${String(n).padStart(2, "0")}</span>${esc(label)}</p>
  <h2 id="${id}-h">${lead}</h2>
  ${body}
</section>`;
}

function empty(text: string): string {
  return `<div class="empty"><p>${text}</p></div>`;
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function renderStages(r: ReportData): string {
  const items = r.stages
    .map(
      (s, i) =>
        `<li class="stage stage-${s.state}"${s.state === "current" || s.state === "blocked" ? ' aria-current="step"' : ""}>` +
        `<span class="dot" aria-hidden="true">${s.state === "done" ? "✓" : s.state === "blocked" ? "!" : i + 1}</span>` +
        `<span class="stage-name">${esc(s.name)}</span>` +
        `<span class="sr-only"> — ${s.state === "done" ? "done" : s.state === "current" ? "current step" : s.state === "blocked" ? "blocked" : "not started"}</span></li>`
    )
    .join("");
  return `<ol class="stages" aria-label="Workflow progress">${items}</ol>`;
}

function renderVitals(r: ReportData): string {
  const m = r.measured;
  const c = m.checks;
  const auto = r.breakingChanges.filter((b) => b.automatable).length;
  const verification = m.checksProblem
    ? { value: "untrusted", tone: "bad", note: "integrity check failed" }
    : !c
      ? { value: "not run", tone: "muted", note: "verify_migration has not run" }
      : m.checksStale
        ? { value: "stale", tone: "warn", note: `ran on ${short(c.headCommit)}` }
        : c.allPassed
          ? { value: "passed", tone: "ok", note: `iteration ${c.iteration} · ${short(c.headCommit)}` }
          : { value: "failed", tone: "bad", note: `iteration ${c.iteration} · ${short(c.headCommit)}` };
  const tile = (value: string, label: string, note: string, tone = "") =>
    `<div class="vital${tone ? ` vital-${tone}` : ""}"><div class="vital-value">${value}</div><div class="vital-label">${esc(label)}</div><div class="vital-note">${note}</div></div>`;
  return `<div class="vitals">
    ${tile(esc(r.analysis.familyFiles), `files use ${r.dependency}`, `${esc(r.analysis.imports)} imports · ${esc(r.analysis.apiUsages)} API usages`)}
    ${tile(m.blastRadius ? esc(m.blastRadius.affectedFiles) : "—", "files need attention", m.blastRadius ? `${m.blastRadius.riskDistribution.high} high-risk` : "risk not scored yet")}
    ${tile(esc(r.breakingChanges.length), "breaking changes apply", r.breakingChanges.length ? `${auto} automated · ${r.breakingChanges.length - auto} manual/review` : "rules not loaded yet")}
    ${tile(esc(verification.value), "verification", esc(verification.note), verification.tone)}
  </div>`;
}

function renderVerification(r: ReportData): string {
  const m = r.measured;
  const c = m.checks;
  if (m.checksProblem) {
    return `<div class="callout callout-bad" role="alert"><strong>Stored verification result rejected.</strong> ${esc(m.checksProblem)}</div>`;
  }
  if (!c) {
    return empty("Verification has not run yet. It runs after the plan is approved and applied: <code>verify_migration</code> checks the installed versions, then runs the repository's own lint, test and build scripts.");
  }
  const row = (name: string, status: CheckStatus, command: string | null, detail: string) =>
    `<tr><th scope="row">${esc(name)}</th><td>${pill(CHECK_TONE[status], checkLabel(status))}</td><td><code>${esc(command ?? "—")}</code></td><td class="detail">${esc(detail)}</td></tr>`;
  const installed = Object.entries(c.dependencies.installed).map(([n, v]) => `${n}@${v ?? "missing"}`).join(", ") || "—";
  const warnings: string[] = [];
  if (m.checksStale) warnings.push("Commits were added after this verification — it does not describe HEAD. Run verify_migration again.");
  if ((c.uncommittedFiles ?? []).length > 0) warnings.push(`It ran with uncommitted changes (${c.uncommittedFiles!.slice(0, 5).join(", ")}), so it did not verify a commit.`);
  const failures = (["lint", "test", "build"] as const)
    .filter((k) => c[k].status === "failed")
    .map(
      (k) =>
        `<details class="output"><summary>${esc(k)} output (${esc(c[k].output.length)} characters)</summary><pre><code>${esc(c[k].output)}</code></pre></details>`
    )
    .join("");
  const history =
    m.history.length > 1
      ? `<ol class="history" aria-label="Verification history">${m.history
          .map((h) => {
            const failed = (["dependencies", "lint", "test", "build"] as const).filter((k) => h.statuses[k] === "failed");
            return `<li class="h-${h.allPassed ? "ok" : "bad"}"><span class="h-mark" aria-hidden="true">${h.allPassed ? "✓" : "✕"}</span>
              <span><strong>#${esc(h.iteration)}</strong> ${h.allPassed ? "passed" : `failed: ${esc(failed.join(", ") || "nothing ran")}`}${h.failedTests.length ? ` <span class="muted">(${esc(h.failedTests.length)} test${h.failedTests.length === 1 ? "" : "s"})</span>` : ""}</span>
              <span class="muted small">commit <code>${short(h.headCommit)}</code> · ${fmtTime(h.timestamp)}</span></li>`;
          })
          .join("")}</ol>`
      : "";
  return `
  ${history}
  <div class="verdict verdict-${c.allPassed && !m.checksStale ? "ok" : m.checksStale ? "warn" : "bad"}">
    <span class="verdict-mark" aria-hidden="true">${c.allPassed ? "✓" : "✕"}</span>
    <div><strong>${c.allPassed ? "Verification passed" : "Verification failed"}</strong>
    <span class="muted">iteration ${esc(c.iteration)} · commit <code>${short(c.headCommit)}</code> · ${fmtTime(c.timestamp)}</span></div>
  </div>
  ${warnings.map((w) => `<div class="callout callout-warn">${esc(w)}</div>`).join("")}
  <div class="table-wrap"><table class="checks">
    <thead><tr><th scope="col">Check</th><th scope="col">Result</th><th scope="col">Command</th><th scope="col">Detail</th></tr></thead>
    <tbody>
      ${row("Installed versions", c.dependencies.status, null, installed)}
      ${row("Lint", c.lint.status, c.lint.command, c.lint.status === "skipped" ? c.lint.output : "")}
      ${row("Test", c.test.status, c.test.command, c.test.failedTests.length ? `${c.test.failedTests.length} failed: ${c.test.failedTests.slice(0, 3).join(", ")}` : c.test.status === "skipped" ? c.test.output : "")}
      ${row("Build", c.build.status, c.build.command, c.build.status === "skipped" ? c.build.output : "")}
    </tbody>
  </table></div>
  ${c.failureSummary ? `<div class="diagnosis"><p class="mini">Failure diagnosis</p><pre><code>${esc(c.failureSummary)}</code></pre></div>` : ""}
  ${failures}`;
}

function renderRisk(r: ReportData): string {
  const br = r.measured.blastRadius;
  if (!br) return empty("Risk has not been scored yet. <code>calculate_migration_blast_radius</code> scores every file from concrete API evidence (see the severity guide).");
  const none = Math.max(0, br.totalFiles - br.affectedFiles);
  const seg = (n: number, cls: string, label: string) =>
    n > 0 ? `<span class="seg seg-${cls}" style="flex-grow:${n}" title="${esc(label)}: ${n}"></span>` : "";
  const legend = (n: number, cls: string, label: string) =>
    `<li><span class="swatch seg-${cls}" aria-hidden="true"></span>${esc(label)} <strong>${n}</strong></li>`;
  const top = r.files.filter((f) => f.riskScore > 0).slice(0, 8);
  return `
  <div class="distribution">
    <div class="stack" role="img" aria-label="${br.riskDistribution.high} high, ${br.riskDistribution.medium} medium, ${br.riskDistribution.low} low risk, ${none} stable files">
      ${seg(br.riskDistribution.high, "high", "High")}${seg(br.riskDistribution.medium, "medium", "Medium")}${seg(br.riskDistribution.low, "low", "Low")}${seg(none, "none", "Stable")}
    </div>
    <ul class="legend">
      ${legend(br.riskDistribution.high, "high", "High ≥70")}${legend(br.riskDistribution.medium, "medium", "Medium 40–69")}${legend(br.riskDistribution.low, "low", "Low 1–39")}${legend(none, "none", "Stable 0")}
    </ul>
  </div>
  ${
    top.length === 0
      ? empty("No file has breaking-change evidence — only stable APIs are used.")
      : `<ol class="ranking">${top
          .map(
            (f) => `<li>
        <span class="score score-${f.tier}">${esc(f.riskScore)}</span>
        <span class="rank-body"><a class="path" href="#file-${slug(f.file)}">${esc(f.file)}</a>
        <span class="bar" aria-hidden="true"><span class="fill fill-${f.tier}" style="width:${Math.min(100, f.riskScore)}%"></span></span>
        <span class="reason">${esc(f.reason)}</span></span>
      </li>`
          )
          .join("")}</ol>`
  }`;
}

function renderBreakingChanges(r: ReportData): string {
  if (r.breakingChanges.length === 0) {
    return r.requirements
      ? empty("No breaking change in the rule set has evidence in this repository.")
      : empty("Rules have not been loaded yet. <code>load_migration_requirements</code> uses the built-in knowledge base, optionally validated by the migration guide you attach.");
  }
  const cards = r.breakingChanges
    .map(
      (bc) => `<article class="bc bc-${esc(bc.severity)}">
      <header>
        <span class="sev sev-${esc(bc.severity)}">${esc(bc.severity)}</span>
        <code class="bc-id">${esc(bc.id)}</code>
        ${bc.automatable ? '<span class="tag">automated</span>' : '<span class="tag tag-manual">manual</span>'}
        ${bc.source === "docs" ? '<span class="tag">from your docs</span>' : bc.docsConfirmed === true ? '<span class="tag">confirmed by docs</span>' : ""}
        <span class="spacer"></span>${pill(STATUS_TONE[bc.status], STATUS_SHORT[bc.status])}
      </header>
      <p>${prose(bc.description)}</p>
      ${bc.manualAction && !bc.automatable ? `<p class="how"><span class="mini">How to fix</span> ${prose(bc.manualAction)}</p>` : ""}
      <p class="files">${bc.files.length} file${bc.files.length === 1 ? "" : "s"}${bc.files.length ? ": " + bc.files.slice(0, 4).map((f) => `<a href="#file-${slug(f)}"><code>${esc(f)}</code></a>`).join(", ") + (bc.files.length > 4 ? ` +${bc.files.length - 4}` : "") : ""}</p>
      ${bc.note ? `<p class="note">${prose(bc.note)}</p>` : ""}
    </article>`
    )
    .join("");
  const warn = (r.requirements?.warnings ?? []).map((w) => `<div class="callout callout-warn">${esc(w)}</div>`).join("");
  return `${warn}<div class="bcs">${cards}</div>`;
}

function renderPlan(r: ReportData): string {
  if (!r.planId) return empty("No plan yet. <code>generate_migration_plan</code> orders the work (dependencies first, then high-severity changes) and waits for your approval.");
  const approval = r.approval.approved
    ? `<div class="approval approval-ok"><span aria-hidden="true">✓</span> Plan <code>${esc(r.planId)}</code> approved ${fmtTime(r.approval.approvedAt)}. Approval is bound to this exact plan — a changed plan needs a new approval.</div>`
    : `<div class="approval approval-wait"><span aria-hidden="true">⏳</span> Plan <code>${esc(r.planId)}</code> is <strong>awaiting approval</strong>. The backend refuses to create the branch or change any file until you reply “approved”.</div>`;
  const steps = r.steps
    .map((s) => {
      const residual = s.outcome?.residual?.length
        ? `<ul class="residual">${s.outcome.residual.slice(0, 6).map((x) => `<li><code>${esc(x)}</code></li>`).join("")}</ul>`
        : "";
      return `<li class="step step-${STATUS_TONE[s.status]}">
        <span class="step-n" aria-hidden="true">${esc(s.order)}</span>
        <div class="step-body">
          <div class="step-head"><strong>${esc(s.title)}</strong></div>
          <div class="step-meta">
            ${pill(STATUS_TONE[s.status], STATUS_SHORT[s.status])}
            <span class="tag">${esc(s.changeType)}</span>
            <span class="tag">${s.automatable ? "automated" : "human"}</span>
            <span class="muted">${esc(s.files.length)} file${s.files.length === 1 ? "" : "s"}</span>
            ${s.outcome?.commit ? `<span class="muted">commit <code>${short(s.outcome.commit)}</code></span>` : ""}
            ${s.outcome?.attempts && s.outcome.attempts > 1 ? `<span class="muted">attempt ${esc(s.outcome.attempts)}</span>` : ""}
          </div>
          ${s.packageChanges?.length ? `<ul class="pkgs">${s.packageChanges.map((c) => `<li><code>${esc(c.name)}</code> ${esc(c.from)} → <strong>${esc(c.to)}</strong>${c.reason && c.reason !== "target" ? ` <span class="muted">(${esc(c.reason)})</span>` : ""}</li>`).join("")}</ul>` : ""}
          ${s.outcome?.note ? `<p class="note">${prose(s.outcome.note)}</p>` : ""}
          ${residual}
          ${s.outcome?.errorOutput ? `<details class="output"><summary>Command output</summary><pre><code>${esc(s.outcome.errorOutput)}</code></pre></details>` : ""}
        </div>
      </li>`;
    })
    .join("");
  return `${approval}
  <p class="muted plan-meta">Estimated effort <strong>${esc((r.estimatedEffort ?? "—").toUpperCase())}</strong> · ${esc(r.steps.length)} steps · ${esc(r.measured.stepCounts.applied)} applied automatically · ${esc(r.measured.stepCounts.completed_manual)} completed manually</p>
  <ol class="steps">${steps}</ol>`;
}

function slug(file: string): string {
  return file.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}

function renderFiles(r: ReportData): string {
  if (r.files.length === 0) return empty(`No file imports the ${esc(r.dependency)} package family.`);
  const counts = { high: 0, medium: 0, low: 0, none: 0 } as Record<FileEvidence["tier"], number>;
  for (const f of r.files) counts[f.tier]++;
  const chip = (tier: string, label: string, n: number) =>
    `<button type="button" class="chip" data-tier-filter="${tier}" aria-pressed="${tier === "all" ? "true" : "false"}">${esc(label)} <span class="muted">${n}</span></button>`;
  const items = r.files
    .map(
      (f) => `<details class="file" id="file-${slug(f.file)}" data-file="${esc(f.file)}" data-tier="${f.tier}"${f.tier === "high" ? " open" : ""}>
      <summary>
        <span class="tier-dot tier-${f.tier}" aria-hidden="true"></span>
        <span class="path">${esc(f.file)}</span>
        ${f.isTest ? '<span class="tag">test</span>' : ""}
        <span class="spacer"></span>
        <span class="file-rules">${f.usages.flatMap((u) => u.rules).filter((v, i, a) => a.indexOf(v) === i).map((id) => `<code class="rule">${esc(id)}</code>`).join("")}</span>
        <span class="score score-${f.tier}" title="risk score">${esc(f.riskScore)}</span>
      </summary>
      <div class="table-wrap"><table class="usages">
        <thead><tr><th scope="col">Line</th><th scope="col">Usage</th><th scope="col">Source</th><th scope="col">Rules</th></tr></thead>
        <tbody>${f.usages
          .map(
            (u) =>
              `<tr${u.rules.length ? ' class="hit"' : ""}><td class="ln">${esc(u.line)}</td><td><code>${esc(u.kind === "import" ? `import ${u.module}` : `${u.api} · ${u.module}`)}</code></td><td class="snippet"><code>${esc(u.snippet)}</code></td><td>${u.rules.map((x) => `<code class="rule">${esc(x)}</code>`).join(" ") || '<span class="muted">—</span>'}</td></tr>`
          )
          .join("")}</tbody>
      </table></div>
      ${f.truncated ? `<p class="muted small">+${esc(f.truncated)} more usages not shown</p>` : ""}
    </details>`
    )
    .join("");
  return `
  <div class="toolbar js-only" role="search">
    <label class="sr-only" for="file-filter">Filter files by path</label>
    <input id="file-filter" type="search" placeholder="Filter by path…" autocomplete="off">
    <div class="chips" role="group" aria-label="Filter by risk tier">
      ${chip("all", "All", r.files.length)}${chip("high", "High", counts.high)}${chip("medium", "Medium", counts.medium)}${chip("low", "Low", counts.low)}${chip("none", "Stable", counts.none)}
    </div>
    <button type="button" class="linkish" id="toggle-all">Expand all</button>
  </div>
  <p class="muted small" id="file-count" aria-live="polite">${r.files.length} files</p>
  <div class="files-list">${items}</div>`;
}

function renderDiffLines(diff: string): string {
  return diff
    .split("\n")
    .map((line) => {
      const cls = line.startsWith("diff --git")
        ? "d-file"
        : line.startsWith("@@")
          ? "d-hunk"
          : line.startsWith("+++") || line.startsWith("---") || line.startsWith("index ")
            ? "d-meta"
            : line.startsWith("+")
              ? "d-add"
              : line.startsWith("-")
                ? "d-del"
                : "d-ctx";
      return `<span class="${cls}">${esc(line) || " "}</span>`;
    })
    .join("");
}

function renderChanges(r: ReportData): string {
  if (r.changes.length === 0) {
    return empty(
      r.approval.approved
        ? "No commits yet. Every automated or recorded step becomes one commit on the migration branch, shown here with its diff."
        : "Nothing has been changed — the plan is not approved, and the backend refuses to modify the repository until it is."
    );
  }
  const files = r.measured.filesChanged;
  return `
  ${files ? `<p class="muted">${esc(files.length)} file${files.length === 1 ? "" : "s"} changed on <code>${esc(r.branch)}</code> since <code>${esc(r.defaultBranch)}</code>.</p>` : ""}
  ${r.changes
    .map(
      (c, i) => `<details class="change"${i < 2 ? " open" : ""}>
      <summary><span class="step-n small" aria-hidden="true">${esc(c.order)}</span><span class="change-title">${esc(c.title)}</span><span class="spacer"></span><code>${short(c.commit)}</code></summary>
      <pre class="stat"><code>${esc(c.stat)}</code></pre>
      <div class="diff-wrap"><pre class="diff" aria-label="Diff for step ${esc(c.order)}"><code>${renderDiffLines(c.diff)}</code></pre></div>
      ${c.diffTruncated ? '<p class="muted small">Diff truncated — see the commit for the full change.</p>' : ""}
    </details>`
    )
    .join("")}`;
}

function renderCompat(r: ReportData): string {
  const c = r.compat;
  if (!c) return empty("Peer-dependency compatibility was not checked for this session.");
  const head = `<p class="muted">Checked ${esc(c.packagesChecked)} package${c.packagesChecked === 1 ? "" : "s"} via ${esc(c.method)}.${c.note ? ` ${esc(c.note)}.` : ""}</p>`;
  if (c.conflicts.length === 0) {
    return `${head}${empty(c.checked ? `No declared package has a peer range that excludes ${esc(r.dependency)} ${esc(r.toVersion)}.` : "Peer ranges could not be checked (no lockfile data, no installed packages, registry lookup unavailable).")}`;
  }
  return `${head}<div class="table-wrap"><table class="compat">
    <thead><tr><th scope="col">Package</th><th scope="col">Requires</th><th scope="col">Source</th><th scope="col">Resolution</th></tr></thead>
    <tbody>${c.conflicts
      .map(
        (k) =>
          `<tr><th scope="row"><code>${esc(k.name)}@${esc(k.version)}</code>${k.section ? "" : ' <span class="tag">transitive</span>'}</th><td><code>${esc(k.peer)} ${esc(k.range)}</code></td><td>${esc(k.source)}</td><td>${
            k.autoUpgrade ? `${pill("ok", "auto")} upgraded to <code>${esc(k.suggestion)}</code> in the dependency step` : k.suggestion ? `${pill("warn", "manual")} try <code>${esc(k.suggestion)}</code>` : pill("warn", "manual")
          }</td></tr>`
      )
      .join("")}</tbody></table></div>`;
}

function renderRemaining(r: ReportData): string {
  if (r.steps.length === 0) return empty("The plan has not been generated yet.");
  if (r.remaining.length === 0) {
    return `<div class="callout callout-ok">Nothing left open: every step was applied, completed manually or is not applicable.</div>`;
  }
  return `<ul class="remaining">${r.remaining
    .map(
      (x) => `<li class="rem rem-${STATUS_TONE[x.status]}">
      <div class="rem-head">${pill(STATUS_TONE[x.status], STATUS_SHORT[x.status])}<code>${esc(x.id)}</code></div>
      <p><strong>${esc(x.title)}</strong></p>
      <p class="muted">${prose(x.action)}</p>
    </li>`
    )
    .join("")}</ul>`;
}

function renderMetrics(r: ReportData): string {
  const m = r.measured;
  const rows = (pairs: Array<[string, string]>) =>
    pairs.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join("");
  return `<div class="metrics">
    <div class="metric-col">
      <p class="mini"><span class="kind kind-measured">measured</span></p>
      <table class="kv"><tbody>${rows([
        [`Files using ${r.dependency}`, String(m.blastRadius?.totalFiles ?? r.analysis.familyFiles)],
        ["Files with breaking-change evidence", m.blastRadius ? String(m.blastRadius.affectedFiles) : "not calculated"],
        ["Files changed on branch", m.filesChanged ? String(m.filesChanged.length) : "branch not created"],
        ["Steps applied automatically", `${m.stepCounts.applied} / ${m.totalSteps}`],
        ["Steps completed manually", String(m.stepCounts.completed_manual)],
        ["Steps still open (manual / skipped / failed)", String(m.stepCounts.manual_required + m.stepCounts.skipped + m.stepCounts.failed)],
        ["Elapsed session time (wall-clock)", `${m.elapsedMinutes} min`],
      ])}</tbody></table>
    </div>
    <div class="metric-col">
      <p class="mini"><span class="kind kind-estimate">estimate</span></p>
      <dl class="estimates">
        <dt>Manual effort</dt><dd><strong>~${esc(r.estimated.manualEffortHours)} h</strong><span>${esc(r.estimated.basis)}</span></dd>
        <dt>Time saved</dt><dd><strong>~${esc(r.estimated.timeSavedHours)} h</strong><span>estimated manual effort − measured elapsed time</span></dd>
      </dl>
    </div>
    <div class="metric-col">
      <p class="mini"><span class="kind kind-none">not measured</span></p>
      <ul class="plain">${r.unavailable.map((u) => `<li>${esc(u)}</li>`).join("")}</ul>
    </div>
  </div>`;
}

function renderRepository(r: ReportData): string {
  const a = r.analysis;
  const rows: Array<[string, string]> = [
    ["Repository", r.repo],
    ["Default branch", r.defaultBranch],
    ["Migration branch", r.branch],
    ["Language", a.language],
    ["Package manager", a.packageManager],
    ["Test framework", a.testFramework ?? "not detected"],
    ["Lint / test / build", [a.commands.lint, a.commands.test, a.commands.build].map((x) => x ?? "none").join(" · ")],
    ["Source files scanned", a.filesScanned === null ? "—" : String(a.filesScanned)],
    ["Rule set", r.requirements ? `${r.requirements.knowledgeBase ?? "no built-in rules"}${r.requirements.docsSupplied ? " + your migration docs" : ""}` : "not loaded"],
    ["Session", r.sessionId],
  ];
  return `<div class="table-wrap"><table class="kv"><tbody>${rows.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td><code>${esc(v)}</code></td></tr>`).join("")}</tbody></table></div>
  ${a.warnings.map((w) => `<div class="callout callout-warn">${esc(w)}</div>`).join("")}`;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function renderHtml(r: ReportData): string {
  const repoLink = safeHref(r.repoUrl);
  const prLink = r.pullRequest ? safeHref(r.pullRequest.url) : null;
  // Reading order: what was found → why → what will change → what changed →
  // did it pass → what is left → numbers → how it was analysed.
  const nav: Array<[string, string]> = [
    ["risk", "Risk & priority"],
    ["breaking-changes", "Breaking changes"],
    ["compatibility", "Compatibility"],
    ["plan", "Migration plan"],
    ["files", "Affected files"],
    ["changes", "Changes"],
    ["verification", "Verification"],
    ["remaining", "Remaining work"],
    ["metrics", "Metrics"],
    ["repository", "Repository"],
  ];
  // Before approval every step is "remaining" by definition — only count open work once it has started.
  const open = r.approval.approved ? r.remaining.length : 0;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(r.dependency)} ${esc(r.fromVersion)} → ${esc(r.toVersion)} · Codebase Doctor</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap">
<script>try{var t=localStorage.getItem("cd-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}</script>
<style>${CSS}</style>
</head>
<body>
<a class="skip" href="#main">Skip to report</a>
${renderTopbar(r.projectUrl)}

<div class="shell">
  <nav class="toc" aria-label="Report sections">
    <p class="label">Contents</p>
    <ol>${nav.map(([id, label], i) => `<li><a href="#${id}"><span class="num">${String(i + 1).padStart(2, "0")}</span>${esc(label)}</a></li>`).join("")}</ol>
  </nav>

  <main id="main">
    <div class="hero">
      <p class="eyebrow">Session <code>${esc(r.sessionId.slice(0, 8))}</code> · generated ${fmtTime(r.generatedAt)}</p>
      <h1><span class="pkg">${esc(r.dependency)}</span> <span class="from">${esc(r.fromVersion)}</span> <span class="arrow" aria-label="to">→</span> <span class="to">${esc(r.toVersion)}</span></h1>
      <p class="hero-meta">${repoLink ? `<a href="${repoLink}">${esc(r.repo)}</a>` : `<span>${esc(r.repo)}</span>`} · <code>${esc(r.branch)}</code> from <code>${esc(r.defaultBranch)}</code>${prLink ? ` · <a href="${prLink}">PR #${esc(r.pullRequest!.number)}</a>` : ""}</p>
      <p class="status status-${r.headline.tone}" role="status"><span class="status-dot" aria-hidden="true"></span>${esc(r.headline.label)}${open > 0 && r.steps.length > 0 ? ` · ${open} open item${open === 1 ? "" : "s"}` : ""}</p>
      ${renderStages(r)}
      <div class="next"><p class="mini">Next action</p><p>${prose(r.nextAction)}</p></div>
      ${renderVitals(r)}
    </div>

    ${section("risk", 1, "Risk & priority", "Which files matter most, scored from concrete API evidence.", renderRisk(r))}
    ${section("breaking-changes", 2, "Breaking changes", "The rules that apply to this repository — and why.", renderBreakingChanges(r))}
    ${section("compatibility", 3, "Compatibility", "Declared packages whose peer ranges could block the install.", renderCompat(r))}
    ${section("plan", 4, "Migration plan", "What will change, in order, and what has happened so far.", renderPlan(r))}
    ${section("files", 5, "Affected files", "Every file that uses the package family, with line-level evidence.", renderFiles(r))}
    ${section("changes", 6, "Changes", "Each step's commit on the migration branch.", renderChanges(r))}
    ${section("verification", 7, "Verification", "Does the upgraded code pass the repository's own checks?", renderVerification(r))}
    ${section("remaining", 8, "Remaining work", "What still needs a human before (or after) merging.", renderRemaining(r))}
    ${section("metrics", 9, "Metrics", "Measured values, labelled estimates, and what is not measured.", renderMetrics(r))}
    ${section("repository", 10, "Repository", "How the repository was analysed.", renderRepository(r))}

    ${prLink ? `<section class="pr-card" aria-label="Pull request"><p class="mini">Pull request</p><a href="${prLink}">${esc(r.pullRequest!.url)}</a></section>` : ""}
  </main>
</div>

<footer class="foot">
  <div class="foot-inner">
    <span>Generated by <a href="${safeHref(r.projectUrl) ?? "#"}">Codebase Doctor</a> from persisted session data — nothing on this page is typed in by hand.</span>
    <span class="muted">Made with IBM Bob</span>
  </div>
</footer>
<script>${SCRIPT}</script>
</body>
</html>`;
}

/** Sticky top bar: the brand (a link home when a project URL is known) and the three-way theme switch. */
export function renderTopbar(projectUrl: string | null | undefined): string {
  const home = safeHref(projectUrl ?? null);
  const brand = `<span class="slashes" aria-hidden="true">//</span> codebase-doctor`;
  return `<header class="topbar">
  <div class="topbar-inner">
    ${home ? `<a class="brand" href="${home}" aria-label="Codebase Doctor home">${brand}</a>` : `<span class="brand">${brand}</span>`}
    <span class="topbar-meta">migration dossier</span>
    <span class="spacer"></span>
    <div class="theme-switch js-only" role="radiogroup" aria-label="Colour theme">${THEME_OPTIONS.map(
      ([mode, label, icon]) =>
        `<button type="button" role="radio" aria-checked="${mode === "system"}" data-theme-mode="${mode}" title="${label} theme">${icon}<span class="sr-only">${label}</span></button>`
    ).join("")}</div>
  </div>
</header>`;
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

const ICON_ATTRS = `viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"`;
const THEME_OPTIONS: Array<[mode: string, label: string, icon: string]> = [
  ["system", "System", `<svg ${ICON_ATTRS}><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>`],
  ["light", "Light", `<svg ${ICON_ATTRS}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`],
  ["dark", "Dark", `<svg ${ICON_ATTRS}><path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7Z"/></svg>`],
];

const SCRIPT = `
(function () {
  var root = document.documentElement;
  root.classList.add("js");

  // Theme: a three-way switch (system / light / dark), remembered per browser.
  var KEY = "cd-theme", mode = "system";
  try { mode = localStorage.getItem(KEY) || "system"; } catch (e) {}
  var opts = Array.prototype.slice.call(document.querySelectorAll("[data-theme-mode]"));
  if (!opts.some(function (o) { return o.getAttribute("data-theme-mode") === mode; })) mode = "system";
  function apply() {
    if (mode === "system") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", mode);
    opts.forEach(function (o) {
      var on = o.getAttribute("data-theme-mode") === mode;
      o.setAttribute("aria-checked", on ? "true" : "false");
      o.tabIndex = on ? 0 : -1;
    });
  }
  function choose(m) { mode = m; try { localStorage.setItem(KEY, m); } catch (e) {} apply(); }
  opts.forEach(function (o, i) {
    o.addEventListener("click", function () { choose(o.getAttribute("data-theme-mode")); });
    o.addEventListener("keydown", function (e) {
      var d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      var n = opts[(i + d + opts.length) % opts.length];
      choose(n.getAttribute("data-theme-mode"));
      n.focus();
    });
  });
  apply();

  // Contents: highlight the section being read.
  var links = Array.prototype.slice.call(document.querySelectorAll('.toc a[href^="#"]'));
  var targets = links.map(function (a) { return document.getElementById(a.getAttribute("href").slice(1)); });
  var tocList = document.querySelector(".toc ol");
  var current = null, clicked = -1, ticking = false;
  function inView(el) { var r = el.getBoundingClientRect(); return r.top < window.innerHeight && r.bottom > 64; }
  function spy() {
    ticking = false;
    var line = 64 + Math.min(window.innerHeight * 0.3, 220), idx = -1;
    targets.forEach(function (t, i) { if (t && t.getBoundingClientRect().top <= line) idx = i; });
    // At the bottom of the page the last sections can never reach the line.
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
      idx = clicked >= 0 && targets[clicked] && inView(targets[clicked]) ? clicked : targets.length - 1;
    }
    var next = idx >= 0 ? links[idx] : null;
    if (next === current) return;
    if (current) { current.classList.remove("active"); current.removeAttribute("aria-current"); }
    current = next;
    if (!current) return;
    current.classList.add("active");
    current.setAttribute("aria-current", "location");
    // On narrow screens the contents are a horizontal row of chips: keep the active one in view.
    if (tocList && tocList.scrollWidth > tocList.clientWidth) {
      var li = current.parentNode;
      tocList.scrollTo({ left: li.offsetLeft - (tocList.clientWidth - li.offsetWidth) / 2, behavior: "smooth" });
    }
  }
  function schedule() { if (!ticking) { ticking = true; requestAnimationFrame(spy); } }
  links.forEach(function (a, i) { a.addEventListener("click", function () { clicked = i; }); });
  ["wheel", "touchmove", "keydown"].forEach(function (ev) { window.addEventListener(ev, function () { clicked = -1; }, { passive: true }); });
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
  spy();

  var files = Array.prototype.slice.call(document.querySelectorAll(".file"));
  var input = document.getElementById("file-filter");
  var count = document.getElementById("file-count");
  var chips = Array.prototype.slice.call(document.querySelectorAll("[data-tier-filter]"));
  var tier = "all";
  function filter() {
    var q = (input && input.value || "").toLowerCase(), shown = 0;
    files.forEach(function (f) {
      var ok = (!q || f.getAttribute("data-file").toLowerCase().indexOf(q) !== -1) && (tier === "all" || f.getAttribute("data-tier") === tier);
      f.hidden = !ok; if (ok) shown++;
    });
    if (count) count.textContent = shown + " of " + files.length + " files";
  }
  if (input) input.addEventListener("input", filter);
  chips.forEach(function (c) {
    c.addEventListener("click", function () {
      tier = c.getAttribute("data-tier-filter");
      chips.forEach(function (o) { o.setAttribute("aria-pressed", o === c ? "true" : "false"); });
      filter();
    });
  });
  var toggle = document.getElementById("toggle-all");
  if (toggle) toggle.addEventListener("click", function () {
    var anyClosed = files.some(function (f) { return !f.hidden && !f.open; });
    files.forEach(function (f) { if (!f.hidden) f.open = anyClosed; });
    toggle.textContent = anyClosed ? "Collapse all" : "Expand all";
  });
})();
`;

const CSS = `
:root {
  --paper: #fafaf8; --surface: #ffffff; --sunken: #f3f3ef; --ink: #16161a; --body: #4a4a52; --muted: #666670; --faint: #9a9aa3;
  --line: rgba(22, 22, 26, .10); --line-strong: rgba(22, 22, 26, .20);
  --accent: #d08700; --accent-ink: #8f5c00; --accent-soft: #fbf1dc;
  --ok: #15803d; --ok-soft: #e8f6ec; --bad: #b42318; --bad-soft: #fdecea; --warn: #8f5c00; --warn-soft: #fbf1dc; --info: #3f3f46; --info-soft: #eeeeea;
  --t-high: #c2362f; --t-medium: #d08700; --t-low: #3f9b62; --t-none: #d6d6db;
  --add: #e8f6ec; --add-ink: #14532d; --del: #fdecea; --del-ink: #8a1c14; --hunk: #8f5c00;
  --mono: "JetBrains Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  --radius: 10px;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --paper: #0e0e10; --surface: #151518; --sunken: #1b1b1f; --ink: #f2f2f4; --body: #c7c7ce; --muted: #9d9da8; --faint: #6f6f79;
    --line: rgba(255, 255, 255, .08); --line-strong: rgba(255, 255, 255, .18);
    --accent: #f0a93b; --accent-ink: #f0b95e; --accent-soft: rgba(240, 169, 59, .12);
    --ok: #4ade80; --ok-soft: rgba(74, 222, 128, .10); --bad: #f87171; --bad-soft: rgba(248, 113, 113, .11); --warn: #f0b95e; --warn-soft: rgba(240, 169, 59, .12); --info: #d4d4d8; --info-soft: rgba(255, 255, 255, .06);
    --t-high: #f87171; --t-medium: #f0a93b; --t-low: #4ade80; --t-none: #34343c;
    --add: rgba(74, 222, 128, .10); --add-ink: #a7f3c0; --del: rgba(248, 113, 113, .11); --del-ink: #fecaca; --hunk: #f0b95e;
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --paper: #0e0e10; --surface: #151518; --sunken: #1b1b1f; --ink: #f2f2f4; --body: #c7c7ce; --muted: #9d9da8; --faint: #6f6f79;
  --line: rgba(255, 255, 255, .08); --line-strong: rgba(255, 255, 255, .18);
  --accent: #f0a93b; --accent-ink: #f0b95e; --accent-soft: rgba(240, 169, 59, .12);
  --ok: #4ade80; --ok-soft: rgba(74, 222, 128, .10); --bad: #f87171; --bad-soft: rgba(248, 113, 113, .11); --warn: #f0b95e; --warn-soft: rgba(240, 169, 59, .12); --info: #d4d4d8; --info-soft: rgba(255, 255, 255, .06);
  --t-high: #f87171; --t-medium: #f0a93b; --t-low: #4ade80; --t-none: #34343c;
  --add: rgba(74, 222, 128, .10); --add-ink: #a7f3c0; --del: rgba(248, 113, 113, .11); --del-ink: #fecaca; --hunk: #f0b95e;
  color-scheme: dark;
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } * { transition: none !important; } }
body { margin: 0; background: var(--paper); color: var(--body); font: 400 13.5px/1.65 var(--mono); -webkit-font-smoothing: antialiased; }
[hidden] { display: none !important; }
a { color: var(--ink); text-decoration: underline; text-decoration-color: var(--accent); text-underline-offset: 3px; }
a:hover { color: var(--accent-ink); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
code { font-family: var(--mono); font-size: .92em; color: var(--ink); }
strong { color: var(--ink); font-weight: 700; }
.muted { color: var(--muted); }
.small { font-size: 12px; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.skip { position: absolute; left: 12px; top: -40px; background: var(--ink); color: var(--paper); padding: 6px 10px; border-radius: 6px; z-index: 10; }
.skip:focus { top: 12px; }
.js-only { display: none; }
.js .js-only { display: flex; }
.js button.js-only { display: inline-block; }
.spacer { flex: 1; }

/* top bar */
.topbar { border-bottom: 1px solid var(--line); background: color-mix(in srgb, var(--paper) 88%, transparent); position: sticky; top: 0; z-index: 5; backdrop-filter: saturate(1.2) blur(6px); }
.topbar-inner { max-width: 1180px; margin: 0 auto; padding: 12px 32px; display: flex; align-items: center; gap: 14px; }
.brand { font-weight: 700; color: var(--ink); letter-spacing: -.01em; }
a.brand { text-decoration: none; border-radius: 6px; }
a.brand:hover { color: var(--ink); }
a.brand:hover .slashes { color: var(--accent-ink); }
.theme-switch { gap: 2px; padding: 3px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); }
.theme-switch button { display: grid; place-items: center; width: 30px; height: 24px; padding: 0; border: 0; border-radius: 999px; background: none; color: var(--muted); cursor: pointer; transition: background .15s, color .15s; }
.theme-switch button:hover { color: var(--ink); }
.theme-switch button[aria-checked="true"] { background: var(--sunken); color: var(--ink); box-shadow: inset 0 0 0 1px var(--line); }
.theme-switch svg { width: 14px; height: 14px; }
.slashes { color: var(--accent); margin-right: 2px; }
.topbar-meta { color: var(--muted); font-size: 12px; padding-left: 14px; border-left: 1px solid var(--line); }
.linkish { background: none; border: 1px solid var(--line); color: var(--body); font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 999px; cursor: pointer; }
.linkish:hover { border-color: var(--line-strong); color: var(--ink); }

/* layout */
.shell { max-width: 1180px; margin: 0 auto; padding: 40px 32px 72px; display: grid; grid-template-columns: 188px minmax(0, 1fr); gap: 56px; }
.toc { position: sticky; top: 76px; align-self: start; }
.toc ol { list-style: none; margin: 10px 0 0; padding: 0; }
.toc a { position: relative; display: flex; gap: 10px; padding: 5px 0; color: var(--body); text-decoration: none; font-size: 12.5px; transition: color .15s; }
.toc a::before { content: ""; position: absolute; left: -14px; top: 7px; bottom: 7px; width: 2px; border-radius: 2px; background: var(--accent); opacity: 0; transform: scaleY(.4); transition: opacity .2s, transform .2s; }
.toc a:hover { color: var(--ink); }
.toc .num { color: var(--faint); transition: color .15s; }
.toc a.active { color: var(--ink); font-weight: 700; }
.toc a.active .num { color: var(--accent-ink); }
.toc a.active::before { opacity: 1; transform: none; }
.label { font-size: 11px; text-transform: uppercase; letter-spacing: .16em; color: var(--muted); margin: 0; }
.label .num { color: var(--accent-ink); margin-right: 10px; }
.mini { font-size: 11px; text-transform: uppercase; letter-spacing: .14em; color: var(--muted); margin: 0 0 6px; }

/* hero */
.hero { padding-bottom: 8px; }
.eyebrow { margin: 0 0 14px; color: var(--muted); font-size: 12px; }
h1 { margin: 0; color: var(--ink); font-size: clamp(24px, 3.4vw, 34px); line-height: 1.15; letter-spacing: -.03em; font-weight: 700; }
h1 .from { color: var(--muted); font-weight: 500; }
h1 .arrow { color: var(--accent); padding: 0 .12em; }
h1 .to { color: var(--ink); box-shadow: inset 0 -.32em 0 var(--accent-soft); }
.hero-meta { margin: 12px 0 0; color: var(--body); overflow-wrap: anywhere; }
.status { display: inline-flex; align-items: center; gap: 8px; margin: 18px 0 0; padding: 5px 12px 5px 10px; border-radius: 999px; font-size: 12.5px; font-weight: 700; border: 1px solid transparent; }
.status-dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 20%, transparent); }
.status-ok { color: var(--ok); background: var(--ok-soft); }
.status-bad { color: var(--bad); background: var(--bad-soft); }
.status-warn { color: var(--warn); background: var(--warn-soft); }
.status-info { color: var(--info); background: var(--info-soft); }

/* stage tracker */
.stages { list-style: none; margin: 26px 0 0; padding: 0; display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); }
.stage { position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; font-size: 11.5px; color: var(--muted); padding-right: 6px; }
.stage::before { content: ""; position: absolute; top: 11px; left: 24px; right: 0; height: 2px; background: var(--line); }
.stage:last-child::before { display: none; }
.stage-done::before { background: var(--ink); }
.dot { position: relative; z-index: 1; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; font-size: 11px; font-weight: 700; border: 1.5px solid var(--line-strong); background: var(--paper); color: var(--muted); }
.stage-done .dot { background: var(--ink); border-color: var(--ink); color: var(--paper); }
.stage-done { color: var(--body); }
.stage-current .dot { border-color: var(--accent); color: var(--accent-ink); box-shadow: 0 0 0 4px var(--accent-soft); }
.stage-current { color: var(--ink); font-weight: 700; }
.stage-blocked .dot { border-color: var(--bad); background: var(--bad); color: var(--paper); box-shadow: 0 0 0 4px var(--bad-soft); }
.stage-blocked { color: var(--bad); font-weight: 700; }

.next { margin: 26px 0 0; padding: 14px 16px; border: 1px solid var(--line); border-left: 3px solid var(--accent); border-radius: var(--radius); background: var(--surface); }
.next p:last-child { margin: 0; color: var(--ink); }

/* vitals */
.vitals { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 18px 0 0; }
.vital { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 14px 16px; }
.vital-value { font-size: 26px; line-height: 1.1; font-weight: 700; color: var(--ink); letter-spacing: -.02em; }
.vital-label { color: var(--body); margin-top: 4px; }
.vital-note { color: var(--muted); font-size: 12px; margin-top: 2px; }
.vital-ok .vital-value { color: var(--ok); }
.vital-bad .vital-value { color: var(--bad); }
.vital-warn .vital-value { color: var(--warn); }
.vital-muted .vital-value { color: var(--muted); }

/* sections */
.section { margin-top: 64px; scroll-margin-top: 76px; }
.section h2 { margin: 10px 0 18px; color: var(--ink); font-size: 15px; font-weight: 500; letter-spacing: -.01em; }
.empty { border: 1px dashed var(--line-strong); border-radius: var(--radius); padding: 18px; color: var(--muted); background: transparent; }
.empty p { margin: 0; }
.callout { border-radius: var(--radius); padding: 12px 14px; margin: 0 0 12px; border: 1px solid var(--line); }
.callout-ok { background: var(--ok-soft); color: var(--ok); border-color: transparent; }
.callout-warn { background: var(--warn-soft); color: var(--warn); border-color: transparent; }
.callout-bad { background: var(--bad-soft); color: var(--bad); border-color: transparent; }

.pill { display: inline-flex; align-items: center; padding: 1px 8px; border-radius: 999px; font-size: 11.5px; font-weight: 700; white-space: nowrap; }
.pill-ok { background: var(--ok-soft); color: var(--ok); }
.pill-bad { background: var(--bad-soft); color: var(--bad); }
.pill-warn { background: var(--warn-soft); color: var(--warn); }
.pill-muted { background: var(--info-soft); color: var(--muted); }
.tag { display: inline-block; font-size: 11px; padding: 0 7px; border: 1px solid var(--line); border-radius: 6px; color: var(--muted); white-space: nowrap; }
.tag-manual { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 35%, transparent); }

/* tables */
.table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); }
table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
tbody tr:last-child th, tbody tr:last-child td { border-bottom: 0; }
thead th { font-size: 11px; text-transform: uppercase; letter-spacing: .1em; color: var(--muted); font-weight: 500; background: var(--sunken); }
tbody th { color: var(--ink); font-weight: 500; }
td.detail { color: var(--muted); }
.kv th { width: 42%; color: var(--body); font-weight: 400; }
/* Wide tables scroll horizontally on small screens instead of crushing their columns. */
.usages, .checks, .compat { min-width: 600px; }

/* verification */
.verdict { display: flex; align-items: center; gap: 14px; padding: 14px 16px; border-radius: var(--radius); margin-bottom: 12px; }
.verdict strong { display: block; font-size: 15px; }
.verdict .muted { font-size: 12px; }
.verdict-mark { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; font-weight: 700; font-size: 16px; color: var(--paper); flex: none; }
.verdict-ok { background: var(--ok-soft); } .verdict-ok .verdict-mark { background: var(--ok); } .verdict-ok strong { color: var(--ok); }
.verdict-bad { background: var(--bad-soft); } .verdict-bad .verdict-mark { background: var(--bad); } .verdict-bad strong { color: var(--bad); }
.verdict-warn { background: var(--warn-soft); } .verdict-warn .verdict-mark { background: var(--warn); } .verdict-warn strong { color: var(--warn); }
.diagnosis { margin-top: 12px; }
.history { list-style: none; margin: 0 0 14px; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; }
.history li { display: grid; grid-template-columns: auto 1fr; column-gap: 8px; row-gap: 2px; align-items: center; padding: 8px 12px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); }
.history li .small { grid-column: 2; }
.h-mark { width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; font-size: 11px; font-weight: 700; color: var(--paper); grid-row: span 2; }
.h-ok .h-mark { background: var(--ok); } .h-bad .h-mark { background: var(--bad); }
pre { margin: 0; overflow-x: auto; }
.diagnosis pre, .output pre, .stat { background: var(--sunken); border-radius: 8px; padding: 12px 14px; font-size: 12px; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; }
details > summary { cursor: pointer; }
.output { margin-top: 10px; }
.output summary { color: var(--body); font-size: 12.5px; padding: 6px 0; }

/* risk */
.distribution { display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px; }
.stack { display: flex; height: 14px; border-radius: 999px; overflow: hidden; background: var(--sunken); gap: 2px; }
.seg { display: block; min-width: 6px; }
.seg-high { background: var(--t-high); } .seg-medium { background: var(--t-medium); } .seg-low { background: var(--t-low); } .seg-none { background: var(--t-none); }
.legend { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 12px; color: var(--muted); }
.legend strong { margin-left: 4px; }
.swatch { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; vertical-align: -1px; }
.ranking { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.ranking li { display: grid; grid-template-columns: 44px minmax(0, 1fr); gap: 14px; align-items: center; padding: 10px 12px; border-radius: 8px; }
.ranking li:hover { background: var(--surface); }
.rank-body { display: grid; gap: 5px; min-width: 0; }
.path { color: var(--ink); overflow-wrap: anywhere; }
.bar { display: block; height: 4px; background: var(--sunken); border-radius: 999px; overflow: hidden; }
.fill { display: block; height: 100%; border-radius: 999px; }
.fill-high { background: var(--t-high); } .fill-medium { background: var(--t-medium); } .fill-low { background: var(--t-low); } .fill-none { background: var(--t-none); }
.reason { color: var(--muted); font-size: 12px; }
.score { font-weight: 700; font-size: 13px; text-align: center; border-radius: 6px; padding: 3px 0; min-width: 36px; display: inline-block; }
.score-high { color: var(--t-high); background: color-mix(in srgb, var(--t-high) 12%, transparent); }
.score-medium { color: var(--accent-ink); background: color-mix(in srgb, var(--t-medium) 14%, transparent); }
.score-low { color: var(--ok); background: color-mix(in srgb, var(--t-low) 12%, transparent); }
.score-none { color: var(--muted); background: var(--sunken); }

/* breaking changes */
.bcs { display: grid; gap: 12px; }
.bc { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 14px 16px; border-left: 3px solid var(--t-none); }
.bc-high { border-left-color: var(--t-high); } .bc-medium { border-left-color: var(--t-medium); } .bc-low { border-left-color: var(--t-low); }
.bc header { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.bc p { margin: 10px 0 0; }
.bc p code, .note code, .rem code, .next code { background: var(--sunken); padding: 0 4px; border-radius: 4px; }
.bc .files, .bc .note { color: var(--muted); font-size: 12.5px; }
.how { color: var(--body); font-size: 12.5px; }
.how .mini { display: inline; margin-right: 8px; }
.sev { font-size: 10.5px; text-transform: uppercase; letter-spacing: .12em; font-weight: 700; }
.sev-high { color: var(--t-high); } .sev-medium { color: var(--accent-ink); } .sev-low { color: var(--ok); }
.bc-id { font-weight: 700; }

/* plan */
.approval { padding: 12px 14px; border-radius: var(--radius); margin-bottom: 12px; }
.approval-ok { background: var(--ok-soft); color: var(--ok); }
.approval-wait { background: var(--warn-soft); color: var(--warn); }
.approval code, .approval strong { color: inherit; }
.plan-meta { margin: 0 0 14px; }
.steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 0; position: relative; }
.step { display: grid; grid-template-columns: 34px minmax(0, 1fr); gap: 14px; padding: 14px 0; border-bottom: 1px solid var(--line); }
.step:last-child { border-bottom: 0; }
.step-n { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; font-weight: 700; font-size: 12px; background: var(--sunken); color: var(--ink); border: 1px solid var(--line); }
.step-n.small { width: 22px; height: 22px; font-size: 11px; border-radius: 6px; }
.step-ok .step-n { background: var(--ok-soft); color: var(--ok); border-color: transparent; }
.step-warn .step-n { background: var(--warn-soft); color: var(--warn); border-color: transparent; }
.step-bad .step-n { background: var(--bad-soft); color: var(--bad); border-color: transparent; }
.step-head strong { font-weight: 500; }
.step-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 8px; font-size: 12px; }
.step .note { margin: 8px 0 0; color: var(--muted); font-size: 12.5px; }
.pkgs, .residual { margin: 8px 0 0; padding-left: 18px; font-size: 12.5px; }
.residual code { color: var(--warn); }

/* files explorer */
.toolbar { flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 8px; }
.toolbar input { font: inherit; font-size: 12.5px; color: var(--ink); background: var(--surface); border: 1px solid var(--line-strong); border-radius: 8px; padding: 7px 10px; min-width: 220px; flex: 1 1 220px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); color: var(--body); cursor: pointer; }
.chip[aria-pressed="true"] { background: var(--ink); color: var(--paper); border-color: var(--ink); }
.chip[aria-pressed="true"] .muted { color: color-mix(in srgb, var(--paper) 70%, transparent); }
.files-list { display: grid; gap: 8px; }
.file { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); }
.file > summary { display: flex; align-items: center; gap: 10px; padding: 10px 14px; list-style: none; flex-wrap: wrap; }
.file > summary::-webkit-details-marker { display: none; }
.file > summary::before { content: "▸"; color: var(--faint); font-size: 11px; transition: transform .15s ease; }
.file[open] > summary::before { transform: rotate(90deg); }
.file[open] > summary { border-bottom: 1px solid var(--line); }
.file .table-wrap { border: 0; border-radius: 0 0 var(--radius) var(--radius); }
.tier-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.tier-high { background: var(--t-high); } .tier-medium { background: var(--t-medium); } .tier-low { background: var(--t-low); } .tier-none { background: var(--t-none); }
.file-rules { display: flex; flex-wrap: wrap; gap: 4px; }
.rule { font-size: 11px; padding: 0 6px; border-radius: 5px; background: var(--accent-soft); color: var(--accent-ink); }
.usages td.ln { color: var(--faint); width: 52px; }
.usages td.snippet code { color: var(--body); white-space: pre-wrap; overflow-wrap: anywhere; }
.usages tr.hit td.ln { color: var(--accent-ink); font-weight: 700; }

/* changes */
.change { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); margin-bottom: 10px; }
.change > summary { display: flex; align-items: center; gap: 10px; padding: 10px 14px; list-style: none; }
.change > summary::-webkit-details-marker { display: none; }
.change-title { color: var(--ink); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.change .stat { margin: 0 14px 10px; }
.diff-wrap { border-top: 1px solid var(--line); overflow-x: auto; }
.diff { padding: 10px 0; font-size: 12px; line-height: 1.6; }
.diff span { display: block; padding: 0 14px; white-space: pre; min-width: max-content; }
.d-add { background: var(--add); color: var(--add-ink); }
.d-del { background: var(--del); color: var(--del-ink); }
.d-hunk { color: var(--hunk); }
.d-file { color: var(--ink); font-weight: 700; padding-top: 6px !important; }
.d-meta { color: var(--faint); }
.d-ctx { color: var(--body); }

/* remaining */
.remaining { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.rem { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 12px 14px; }
.rem-head { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.rem p { margin: 8px 0 0; }

/* metrics */
.metrics { display: grid; grid-template-columns: 1.3fr 1fr .8fr; gap: 12px; }
.metric-col { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 12px 14px; }
.metric-col .kv th, .metric-col .kv td { padding: 6px 0; border-bottom: 1px solid var(--line); }
.metric-col .kv tr:last-child th, .metric-col .kv tr:last-child td { border-bottom: 0; }
.kind { display: inline-block; padding: 1px 8px; border-radius: 999px; font-weight: 700; letter-spacing: .08em; }
.kind-measured { background: var(--ok-soft); color: var(--ok); }
.kind-estimate { background: var(--warn-soft); color: var(--warn); }
.kind-none { background: var(--info-soft); color: var(--muted); }
.plain { margin: 0; padding-left: 18px; color: var(--muted); font-size: 12.5px; }
.estimates { margin: 4px 0 0; }
.estimates dt { color: var(--body); margin-top: 10px; }
.estimates dd { margin: 2px 0 0; display: grid; gap: 2px; }
.estimates dd strong { font-size: 18px; letter-spacing: -.01em; }
.estimates dd span { color: var(--muted); font-size: 12px; }

.pr-card { margin-top: 48px; padding: 16px; border-radius: var(--radius); background: var(--ok-soft); overflow-wrap: anywhere; }
.pr-card a { color: var(--ok); font-weight: 700; }

.foot { border-top: 1px solid var(--line); }
.foot-inner { max-width: 1180px; margin: 0 auto; padding: 20px 32px 32px; display: flex; flex-wrap: wrap; gap: 8px 24px; justify-content: space-between; font-size: 12px; color: var(--body); }

/* responsive */
@media (max-width: 1024px) {
  .shell { grid-template-columns: minmax(0, 1fr); gap: 0; padding-top: 16px; }
  .toc { position: static; margin-bottom: 28px; }
  .toc ol { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 6px; scrollbar-width: thin; }
  .toc a { white-space: nowrap; border: 1px solid var(--line); border-radius: 999px; padding: 4px 10px; background: var(--surface); }
  .toc a::before { display: none; }
  .toc a.active { border-color: var(--accent); background: var(--accent-soft); }
  .toc .label { display: none; }
  .metrics { grid-template-columns: 1fr 1fr; }
  .metric-col:first-child { grid-column: 1 / -1; }
}
@media (max-width: 720px) {
  .topbar-inner, .shell, .foot-inner { padding-left: 16px; padding-right: 16px; }
  .topbar-meta { display: none; }
  .vitals { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .stages { grid-template-columns: repeat(4, minmax(0, 1fr)); row-gap: 16px; }
  .stage:nth-child(4)::before { display: none; }
  .metrics { grid-template-columns: 1fr; }
  .section { margin-top: 48px; }
  .file-rules { display: none; }
  .kv th { width: auto; }
}
@media print {
  .topbar, .toc, .toolbar, .theme-switch, .skip { display: none !important; }
  .shell { display: block; padding: 0; }
  body { background: #fff; }
  .section { break-inside: avoid-page; }
}
`;

/** The data-independent parts of the page, so stored snapshots can be brought up to the current layout. */
export { CSS as REPORT_CSS, SCRIPT as REPORT_SCRIPT };
