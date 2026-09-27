#!/usr/bin/env node
/**
 * Builds the generated parts of the project site (site/):
 *
 *   site/reports/*.html   The report snapshots from the recorded end-to-end run
 *                         (docs/evidence/e2e-run/reports), brought up to the current report layout: their stylesheet,
 *                         script and top bar are replaced with the ones backend/dist/lib/report-html.js renders today.
 *                         Everything that comes from session data is left exactly as recorded.
 *   site/sandbox/…        The run's sandbox pull-request page, hosted so the reports' "PR #1" links work.
 *   site/try/run.json     The recorded MCP calls the "Try it" replay steps through.
 *
 * Site-only link changes (the recorded run used a local sandbox, which a visitor cannot reach):
 *   - the sandbox PR URL (http://127.0.0.1:55781/…/pull/1) points to the hosted copy of that page;
 *   - the sandbox's placeholder GitHub address is shown as plain text, as the report does for a repository without one;
 *   - the brand links to the site's home page.
 *
 * Usage: npm run build && node scripts/site/build-site.mjs [--origin https://codebase-doctor-bob2.vercel.app]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const evidence = path.join(root, "docs", "evidence", "e2e-run");
const site = path.join(root, "site");
const originArg = process.argv.indexOf("--origin");
const ORIGIN = originArg > 0 ? process.argv[originArg + 1] : "https://codebase-doctor-bob2.vercel.app";

const { REPORT_CSS, REPORT_SCRIPT, renderTopbar } = await import(
  pathToFileURL(path.join(root, "backend", "dist", "lib", "report-html.js")).href
);

const SANDBOX_PR = "http://127.0.0.1:55781/codebase-doctor-sandbox/pantry-list/pull/1";
const SANDBOX_PATH = "/sandbox/codebase-doctor-sandbox/pantry-list/pull/1/";
const SANDBOX_REPO_LINK = '<a href="https://github.com/codebase-doctor-sandbox/pantry-list">codebase-doctor-sandbox/pantry-list</a>';

/** Replace exactly one match of `re`, or stop: a stored report that doesn't have the expected shape is not rewritten. */
function replaceOnce(html, re, replacement, what, file) {
  const matches = html.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g")) ?? [];
  if (matches.length !== 1) throw new Error(`${file}: expected one ${what}, found ${matches.length}`);
  return html.replace(re, () => replacement);
}

// 1. Reports
const outReports = path.join(site, "reports");
fs.mkdirSync(outReports, { recursive: true });
const files = fs.readdirSync(path.join(evidence, "reports")).filter((f) => f.endsWith(".html")).sort();
let chrome = null;
for (const file of files) {
  let html = fs.readFileSync(path.join(evidence, "reports", file), "utf8");
  // Every snapshot must carry the same (old) chrome — i.e. they were rendered by one version of the renderer.
  const old = [
    html.match(/<style>[\s\S]*?<\/style>/)?.[0],
    html.match(/<header class="topbar">[\s\S]*?<\/header>/)?.[0],
    html.match(/<script>(?:(?!<\/script>)[\s\S])*<\/script>\s*<\/body>/)?.[0],
  ].join("\n");
  if (chrome === null) chrome = old;
  else if (old !== chrome) throw new Error(`${file}: page chrome differs from ${files[0]}; not rewriting`);

  html = replaceOnce(html, /<style>[\s\S]*?<\/style>/, `<style>${REPORT_CSS}</style>`, "stylesheet", file);
  html = replaceOnce(html, /<header class="topbar">[\s\S]*?<\/header>/, renderTopbar(ORIGIN + "/"), "top bar", file);
  html = replaceOnce(html, /<script>(?:(?!<\/script>)[\s\S])*<\/script>(\s*<\/body>)/, `<script>${REPORT_SCRIPT}</script>\n</body>`, "page script", file);

  const prCount = html.split(SANDBOX_PR).length - 1;
  html = html.split(SANDBOX_PR).join(ORIGIN + SANDBOX_PATH);
  const repoCount = html.split(SANDBOX_REPO_LINK).length - 1;
  html = html.split(SANDBOX_REPO_LINK).join("<span>codebase-doctor-sandbox/pantry-list</span>");
  if (/127\.0\.0\.1|localhost|github\.com\/codebase-doctor-sandbox/.test(html)) throw new Error(`${file}: a local or sandbox link is left`);

  fs.writeFileSync(path.join(outReports, file), html);
  console.log(`reports/${file}  sandbox PR links: ${prCount}, sandbox repo links: ${repoCount}`);
}

// 2. Sandbox pull-request page
const sandboxSrc = path.join(evidence, "sandbox-pr-1.html");
const sandboxHtml = fs.readFileSync(sandboxSrc, "utf8");
if (/127\.0\.0\.1|localhost/.test(sandboxHtml)) throw new Error("sandbox page contains a local link");
const sandboxOut = path.join(site, ...SANDBOX_PATH.split("/").filter(Boolean));
fs.mkdirSync(sandboxOut, { recursive: true });
fs.writeFileSync(path.join(sandboxOut, "index.html"), sandboxHtml);
console.log(`${SANDBOX_PATH}index.html`);

// 3. Replay data for /try
const { summary, transcript } = JSON.parse(fs.readFileSync(path.join(evidence, "transcript.json"), "utf8"));
const snapshots = {
  "01-analysed": "01-analysed.html", "02-rules-loaded": "02-rules-loaded.html", "03-awaiting-approval": "03-awaiting-approval.html",
  "04-manual-work-open": "04-manual-work-open.html", "05-verification-failed": "05-verification-failed.html", "06-verified": "06-verified.html",
  "07-final": "07-final.html", "08-step-failed": "08-step-failed.html", "09-verification-untrusted": "09-verification-untrusted.html",
  "10-step-retried": "10-step-retried.html",
};
const entries = transcript.map((e, i) => {
  if (e.kind === "human") return { i, kind: "human", action: e.action, detail: e.detail ?? null };
  const snap = /report snapshot: (\S+)/.exec(e.label ?? "")?.[1];
  return {
    i, kind: "tool", tool: e.tool, args: e.args, isError: e.isError, ms: e.ms, label: e.label ?? null,
    text: snap ? null : e.text.split(SANDBOX_PR).join(ORIGIN + SANDBOX_PATH), report: snap ? snapshots[snap] ?? null : null,
    markdown: e.label === "markdown report (PR body)",
  };
});
const tryDir = path.join(site, "try");
fs.mkdirSync(tryDir, { recursive: true });
fs.writeFileSync(
  path.join(tryDir, "run.json"),
  JSON.stringify({ recordedAt: summary.generatedAt, node: summary.node, toolCalls: summary.toolCalls, sessions: { main: summary.mainSessionId, peer: summary.failedSessionId, tampered: summary.tamperedSessionId }, sandboxPr: SANDBOX_PATH, entries })
);
console.log(`try/run.json  ${entries.length} entries (${summary.toolCalls} tool calls)`);
