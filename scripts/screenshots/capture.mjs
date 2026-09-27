#!/usr/bin/env node
/**
 * Captures features-screen-shots/ from the REAL application:
 *
 *  A. The migration report (generate_report, format "html") at every stage of
 *     the end-to-end run — the HTML files in .demo-run/reports/ are the tool's
 *     own output, opened unchanged in Chrome. Interactive states (filter,
 *     search, expand, theme, keyboard focus) are produced by using the page.
 *  B. The Codebase Doctor MCP server driven through the official MCP Inspector
 *     (a generic MCP client UI) — every result shown is the server's live reply.
 *  C. The sandbox pull-request record (clearly labelled as a sandbox, not GitHub).
 *
 * Prerequisites:
 *   1. cd backend && npm run build
 *   2. node backend/scripts/e2e-demo.mjs --out .demo-run --sandbox-pr [--docs guide.txt]
 *   3. Chrome installed (playwright-core drives it; no browser download)
 *   4. The MCP Inspector: set INSPECTOR_BIN to its launcher
 *      (…/@modelcontextprotocol/inspector/clients/launcher/build/index.js), or
 *      it is run with `npx -y @modelcontextprotocol/inspector@2.8.0`.
 *
 * Usage: node scripts/screenshots/capture.mjs [--docs guide.txt] [--only reports|inspector|sandbox]
 */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { renderPrPage } from "../../backend/scripts/github-sandbox.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const RUN = path.resolve(process.argv.includes("--run") ? process.argv[process.argv.indexOf("--run") + 1] : path.join(root, ".demo-run"));
const OUT = path.join(root, "features-screen-shots");
const argv = process.argv.slice(2);
const only = argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : null;
const docsFile = argv.includes("--docs") ? argv[argv.indexOf("--docs") + 1] : null;

if (!fs.existsSync(path.join(RUN, "transcript.json"))) {
  console.error("Run backend/scripts/e2e-demo.mjs --out .demo-run --sandbox-pr first.");
  process.exit(1);
}
const { summary } = JSON.parse(fs.readFileSync(path.join(RUN, "transcript.json"), "utf8"));
const captured = [];

const browser = await chromium.launch({ channel: "chrome" });
const DESKTOP = { width: 1440, height: 900 };

async function save(page, folder, name, opts = {}) {
  const dir = path.join(OUT, folder);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.png`);
  if (opts.element) await opts.element.screenshot({ path: file });
  else await page.screenshot({ path: file, fullPage: Boolean(opts.fullPage) });
  captured.push(path.relative(OUT, file).split(path.sep).join("/"));
  console.log(`  ✓ ${folder}/${name}.png`);
}

// ---------------------------------------------------------------------------
// A. Migration report
// ---------------------------------------------------------------------------

const report = (name) => pathToFileURL(path.join(RUN, "reports", `${name}.html`)).href;

async function openReport(name, { width = 1440, height = 900, scheme = "light", unpin = false } = {}) {
  const page = await browser.newPage({ viewport: { width, height }, colorScheme: scheme });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(report(name), { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  // Section captures: let the sticky top bar scroll away so it does not overlap the captured element.
  if (unpin) await page.addStyleTag({ content: ".topbar{position:static!important}" });
  await page.waitForTimeout(250);
  page.errors = errors;
  return page;
}

/** Scroll a section to the top once web fonts have loaded (an early #hash jump lands in the wrong place after reflow). */
async function scrollToSection(page, id) {
  await page.evaluate(async (target) => {
    await document.fonts.ready;
    // "instant": the report uses scroll-behavior: smooth, and a capture mid-animation lands on the wrong section.
    document.getElementById(target).scrollIntoView({ block: "start", behavior: "instant" });
  }, id);
  await page.waitForTimeout(300);
}

async function section(name, id, folder, file, opts = {}) {
  const page = await openReport(name, { unpin: true, scheme: opts.scheme });
  if (opts.before) await opts.before(page);
  await save(page, folder, file, { element: page.locator(`#${id}`) });
  if (page.errors.length) throw new Error(`console errors in ${name}: ${page.errors.join("; ")}`);
  await page.close();
}

async function captureReports() {
  console.log("A. Migration report (generate_report html) at each stage");
  // 01 overview
  let p = await openReport("07-final");
  await save(p, "01-overview", "report-final-state-pr-open");
  await p.close();
  p = await openReport("07-final");
  await save(p, "11-reports", "report-final-full-page-light", { fullPage: true });
  await p.close();
  p = await openReport("07-final", { scheme: "dark" });
  await save(p, "11-reports", "report-final-full-page-dark", { fullPage: true });
  await save(p, "14-responsive-layouts", "desktop-dark-mode");
  await p.close();

  // 03 analysis
  p = await openReport("01-analysed");
  await save(p, "03-repository-analysis", "report-after-analysis");
  await p.close();
  await section("07-final", "files", "03-repository-analysis", "affected-files-explorer");
  await section("07-final", "files", "03-repository-analysis", "affected-files-filter-high-risk", {
    before: async (pg) => pg.locator('[data-tier-filter="high"]').click(),
  });
  await section("07-final", "files", "03-repository-analysis", "affected-files-search-legacy", {
    before: async (pg) => {
      await pg.fill("#file-filter", "legacy");
      await pg.click("#toggle-all");
    },
  });
  await section("07-final", "repository", "03-repository-analysis", "repository-details");
  await section("01-analysed", "breaking-changes", "03-repository-analysis", "empty-state-rules-not-loaded");

  // 04 risk
  await section("03-awaiting-approval", "risk", "04-risk-and-prioritization", "risk-distribution-and-ranking");

  // 05 knowledge
  await section("03-awaiting-approval", "breaking-changes", "05-migration-knowledge", "breaking-changes-with-docs-validation");
  await section("03-awaiting-approval", "compatibility", "05-migration-knowledge", "peer-dependency-compatibility");

  // 06/07 planning + approval
  await section("03-awaiting-approval", "plan", "06-migration-planning", "plan-awaiting-approval");
  p = await openReport("03-awaiting-approval");
  await save(p, "07-approval-workflow", "report-awaiting-approval");
  await p.close();
  await section("03-awaiting-approval", "changes", "07-approval-workflow", "nothing-changed-before-approval");

  // 08 execution
  await section("04-manual-work-open", "plan", "08-migration-execution", "plan-steps-in-progress");
  await section("04-manual-work-open", "remaining", "08-migration-execution", "remaining-manual-work");
  p = await openReport("08-step-failed");
  await save(p, "08-migration-execution", "report-step-failed");
  await p.close();
  await section("08-step-failed", "plan", "08-migration-execution", "failed-step-rolled-back-with-output", {
    before: async (pg) => pg.locator(".step details.output").first().evaluate((d) => (d.open = true)),
  });
  await section("08-step-failed", "compatibility", "08-migration-execution", "peer-conflict-flagged-before-install");
  await section("10-step-retried", "plan", "08-migration-execution", "retry-succeeded-after-fix");

  // 09 diffs
  await section("07-final", "changes", "09-code-diff-review", "per-step-commits-and-diffs");

  // 10 verification
  await section("05-verification-failed", "verification", "10-verification", "verification-failed-lint-and-test", {
    before: async (pg) => pg.locator("#verification details.output").last().evaluate((d) => (d.open = true)),
  });
  p = await openReport("05-verification-failed");
  await save(p, "10-verification", "report-verification-failed");
  await p.close();
  await section("07-final", "verification", "10-verification", "verification-passed-with-history");

  // 11 reports: metrics
  await section("07-final", "metrics", "11-reports", "measured-estimated-not-measured");
  await section("07-final", "remaining", "11-reports", "nothing-left-open");

  // 13 errors
  p = await openReport("09-verification-untrusted");
  await save(p, "13-error-and-recovery-states", "report-verification-untrusted");
  await p.close();
  await section("09-verification-untrusted", "verification", "13-error-and-recovery-states", "hand-written-verification-rejected");

  // 14 responsive + accessibility
  p = await openReport("07-final", { width: 390, height: 844 });
  await save(p, "14-responsive-layouts", "mobile-390-hero");
  await scrollToSection(p, "plan");
  await save(p, "14-responsive-layouts", "mobile-390-plan");
  await scrollToSection(p, "files");
  await save(p, "14-responsive-layouts", "mobile-390-files");
  await p.close();
  p = await openReport("05-verification-failed", { width: 390, height: 844, scheme: "dark" });
  await scrollToSection(p, "verification");
  await save(p, "14-responsive-layouts", "mobile-390-dark-verification");
  await p.close();
  p = await openReport("07-final", { width: 834, height: 1112 });
  await save(p, "14-responsive-layouts", "tablet-834");
  await p.close();
  p = await openReport("07-final");
  await scrollToSection(p, "files");
  await p.focus("#file-filter");
  await p.keyboard.press("Tab");
  await p.keyboard.press("Tab");
  await save(p, "14-responsive-layouts", "keyboard-focus-visible");
  await p.close();
  p = await openReport("07-final");
  await p.click("#theme-toggle");
  await p.click("#theme-toggle");
  await p.waitForTimeout(200);
  await save(p, "14-responsive-layouts", "theme-toggle-dark");
  await p.close();
}

// ---------------------------------------------------------------------------
// C. Sandbox pull request
// ---------------------------------------------------------------------------

async function captureSandbox() {
  console.log("C. Sandbox pull request record");
  const pulls = JSON.parse(fs.readFileSync(path.join(RUN, "pr.json"), "utf8"));
  const html = renderPrPage(pulls[0], "codebase-doctor-sandbox", "pantry-list", path.join(RUN, "github-sandbox", "pantry-list.git"));
  const file = path.join(RUN, "sandbox-pr-1.html");
  fs.writeFileSync(file, html);
  const page = await browser.newPage({ viewport: DESKTOP });
  await page.goto(pathToFileURL(file).href, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await save(page, "12-github-integration", "sandbox-pull-request-top");
  await save(page, "12-github-integration", "sandbox-pull-request-full-body", { fullPage: true });
  await page.close();
  const p = await openReport("07-final", { unpin: true });
  await save(p, "12-github-integration", "report-links-pull-request", { element: p.locator(".hero") });
  await p.close();
}

// ---------------------------------------------------------------------------
// B. MCP Inspector driving the real server
// ---------------------------------------------------------------------------

async function startInspector() {
  const cfg = path.join(RUN, "inspector-config.json");
  fs.writeFileSync(
    cfg,
    JSON.stringify(
      {
        mcpServers: {
          "codebase-doctor": {
            command: process.execPath,
            args: [path.join(root, "backend", "dist", "index.js")],
            env: {
              CODEBASE_DOCTOR_HOME: path.join(RUN, "home"),
              GITHUB_TOKEN: "",
              // No real GitHub: API calls go nowhere, pushes go to the sandbox bare repo.
              GITHUB_API_URL: "http://127.0.0.1:9",
              GIT_CONFIG_GLOBAL: path.join(RUN, "github-sandbox", "gitconfig"),
              GIT_CONFIG_NOSYSTEM: "1",
              CODEBASE_DOCTOR_OFFLINE: "1",
            },
            requestTimeout: 900000,
          },
        },
      },
      null,
      2
    )
  );
  const bin = process.env["INSPECTOR_BIN"];
  const [cmd, args] = bin
    ? [process.execPath, [bin, "--web", "--config", cfg]]
    : [process.platform === "win32" ? "npx.cmd" : "npx", ["-y", "@modelcontextprotocol/inspector@2.8.0", "--web", "--config", cfg]];
  const child = spawn(cmd, args, {
    env: { ...process.env, DANGEROUSLY_OMIT_AUTH: "true", MCP_INSPECTOR_SECRET_STORE: "memory", MCP_AUTO_OPEN_ENABLED: "false", BROWSER: "none" },
    stdio: ["ignore", "pipe", "pipe"],
    shell: !bin && process.platform === "win32",
  });
  await new Promise((resolve, reject) => {
    let log = "";
    const onData = (d) => {
      log += d;
      if (/http:\/\/127\.0\.0\.1:6274/.test(log)) resolve();
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => reject(new Error(`inspector exited (${code}): ${log}`)));
    setTimeout(() => reject(new Error(`inspector did not start: ${log}`)), 120_000);
  });
  return child;
}

async function captureInspector(onlyOverview = false) {
  console.log("B. MCP Inspector → real Codebase Doctor server");
  const child = await startInspector();
  const page = await browser.newPage({ viewport: DESKTOP });
  try {
    await page.goto("http://127.0.0.1:6274", { waitUntil: "load" });
    await page.getByRole("switch", { name: /Connect or disconnect/ }).waitFor({ state: "attached", timeout: 60_000 });
    await page.waitForTimeout(800);
    await page.getByRole("switch", { name: /Connect or disconnect/ }).click({ force: true });
    await page.getByText("Connected", { exact: true }).waitFor({ timeout: 60_000 });
    await page.mouse.move(720, 700);
    await page.waitForTimeout(1500); // let the layout switch and sidebar animation settle
    await save(page, "01-overview", "mcp-server-connected-over-stdio");
    await page.getByText("Tools", { exact: true }).click();
    await page.getByRole("button", { name: "Close monitoring sidebar" }).click();
    await page.getByRole("button", { name: "get_session_status", exact: true }).waitFor();
    // Let the sidebar animation and its tooltip finish, and make the window tall enough for all 12 tools.
    await page.mouse.move(720, 700);
    await page.waitForTimeout(900);
    await page.setViewportSize({ width: DESKTOP.width, height: 1080 });
    await page.waitForTimeout(300);
    await save(page, "01-overview", "mcp-tools-list");
    await page.setViewportSize(DESKTOP);
    if (onlyOverview) return;

    const main = summary.mainSessionId;
    const tampered = summary.tamperedSessionId;
    const repo = path.join(RUN, "work", "pantry-list");

    async function call(tool, args, folder, name, { form = false, fullPage = true, retries = 0, waitMs = 900_000 } = {}) {
      // Close the previous result (the unlabelled × next to the "Results" heading) to get the form back.
      const heading = page.getByText("Results", { exact: true });
      if (await heading.isVisible().catch(() => false)) {
        await heading.locator("xpath=..").locator("button").first().click();
        await heading.waitFor({ state: "hidden" });
      }
      await page.getByRole("button", { name: tool, exact: true }).click();
      await page.waitForTimeout(300);
      const sw = page.getByRole("switch", { name: "Edit as JSON" });
      if (form) {
        if (await sw.isChecked()) await sw.click({ force: true });
        for (const [k, v] of Object.entries(args)) await page.getByRole("textbox", { name: k, exact: true }).fill(String(v));
        await save(page, folder, `${name}-form`);
      } else {
        if (!(await sw.isChecked())) await sw.click({ force: true });
        const editor = page.getByRole("textbox", { name: /Arguments JSON/ });
        await editor.focus();
        await page.keyboard.press("Control+A");
        await page.keyboard.press("Delete");
        await page.keyboard.insertText(JSON.stringify(args, null, 2));
      }
      await page.getByRole("button", { name: "Execute Tool" }).click();
      try {
        await page.getByText("Results", { exact: true }).waitFor({ timeout: waitMs });
      } catch (err) {
        // Under heavy machine load a long real run (verify_migration) can outlast the Inspector's
        // request handling; the server still finishes. Retry instead of failing the whole capture.
        if (retries <= 0) throw err;
        console.log(`  … ${tool} did not show a result within ${waitMs / 1000}s — retrying`);
        return call(tool, args, folder, name, { form, fullPage, retries: retries - 1, waitMs });
      }
      await page.waitForTimeout(500);
      const text = await page.locator("body").innerText();
      // The Inspector is a fixed-height app shell: a long result scrolls inside its pane. Grow the viewport by
      // exactly the hidden amount so the whole result is visible — no changes to the page itself.
      const hidden = await page.evaluate(() => {
        const heading = [...document.querySelectorAll("body *")].find((e) => e.children.length === 0 && e.textContent.trim() === "Results");
        let pane = heading;
        while (pane && pane.parentElement && !pane.parentElement.querySelector('input[placeholder="Search tools..."]')) pane = pane.parentElement;
        let max = 0;
        for (const el of (pane ?? document.body).querySelectorAll("*")) {
          const cs = getComputedStyle(el);
          if (/(auto|scroll)/.test(cs.overflowY)) max = Math.max(max, el.scrollHeight - el.clientHeight);
        }
        return max;
      });
      if (hidden > 4) await page.setViewportSize({ width: DESKTOP.width, height: Math.min(6000, DESKTOP.height + hidden + 48) });
      await page.waitForTimeout(300);
      await save(page, folder, name, { fullPage });
      if (hidden > 4) await page.setViewportSize(DESKTOP);
      return text;
    }

    // Repository connection / analysis (a fresh session on the demo repository)
    const analysed = await call("analyze_dependency_usage", { url: repo, dependency: "react", targetVersion: "18.3.1" }, "02-repository-connection", "analyze-repository", { form: true });
    const sid = analysed.match(/Session created: ([0-9a-f-]{36})/)[1];
    await call("analyze_dependency_usage", { url: "https://gitlab.com/acme/shop", dependency: "react", targetVersion: "18" }, "02-repository-connection", "error-unsupported-host");
    await call("analyze_dependency_usage", { url: repo, dependency: "react", targetVersion: "latest" }, "02-repository-connection", "error-dist-tag-instead-of-version");
    await call("analyze_dependency_usage", { url: path.join(repo, "src"), dependency: "react", targetVersion: "18" }, "02-repository-connection", "error-not-a-git-repository");
    await call("analyze_dependency_usage", { url: repo, dependency: "vue", targetVersion: "3" }, "02-repository-connection", "error-dependency-not-declared");
    await call("load_migration_requirements", { sessionId: "not-a-session" }, "02-repository-connection", "error-invalid-session-id-schema");

    const docsText = docsFile ? fs.readFileSync(docsFile, "utf8") : undefined;
    await call("load_migration_requirements", docsText ? { sessionId: sid, docsText } : { sessionId: sid }, "05-migration-knowledge", "load-requirements-validated-by-guide");
    await call("calculate_migration_blast_radius", { sessionId: sid }, "04-risk-and-prioritization", "blast-radius-tool-result");
    const plan = await call("generate_migration_plan", { sessionId: sid }, "06-migration-planning", "generate-plan-tool-result");
    const planId = plan.match(/Plan ID:\W*([0-9a-f]{12})/)[1];
    const depStep = plan.match(/step-\d+-dependencies/)[0];

    // Approval gate
    await call("checkout_branch", { sessionId: sid }, "07-approval-workflow", "checkout-blocked-before-approval");
    await call("apply_migration_patch", { sessionId: sid, stepId: depStep }, "07-approval-workflow", "apply-blocked-before-approval");
    await call("approve_migration_plan", { sessionId: sid, planId, confirmation: "looks good but skip the tests" }, "07-approval-workflow", "approval-refused-not-approved");
    await call("approve_migration_plan", { sessionId: sid, planId, confirmation: "approved" }, "07-approval-workflow", "approval-recorded");
    await call("checkout_branch", { sessionId: sid }, "07-approval-workflow", "migration-branch-created");

    // Execution (automated transform, manual step, skip rules)
    const bc1 = plan.match(/step-\d+-react-bc-1\b/)[0];
    const bc4 = plan.match(/step-\d+-react-bc-4\b/)[0];
    const bc7 = plan.match(/step-\d+-react-bc-7\b/)[0];
    await call("apply_migration_patch", { sessionId: sid, stepId: bc1 }, "08-migration-execution", "codemod-applied-with-diffstat");
    await call("apply_migration_patch", { sessionId: sid, stepId: bc1 }, "08-migration-execution", "rerun-is-a-no-op");
    await call("apply_migration_patch", { sessionId: sid, stepId: bc4 }, "08-migration-execution", "manual-step-reported-as-manual-required");
    await call("apply_migration_patch", { sessionId: sid, stepId: bc7, skip: true }, "08-migration-execution", "skip-requires-a-reason");
    await call("apply_migration_patch", { sessionId: sid, stepId: depStep, skip: true, note: "not now" }, "08-migration-execution", "dependency-step-cannot-be-skipped");
    await call("get_session_status", { sessionId: sid }, "08-migration-execution", "session-status-next-action");
    await call("create_pull_request", { sessionId: sid }, "12-github-integration", "pr-blocked-steps-not-run");

    // Verification + PR on the finished end-to-end session
    await call("verify_migration", { sessionId: main }, "10-verification", "verify-migration-passed", { retries: 2, waitMs: 180_000 });
    await call("create_pull_request", { sessionId: main }, "12-github-integration", "pr-already-open-idempotent");
    await call("generate_report", { sessionId: main, format: "markdown" }, "11-reports", "markdown-report-for-pr-body");

    // Recovery
    await call("get_session_status", {}, "13-error-and-recovery-states", "list-recent-sessions");
    await call("get_session_status", { sessionId: tampered }, "13-error-and-recovery-states", "integrity-check-flags-hand-written-state");
    await call("generate_migration_plan", { sessionId: "00000000-0000-4000-8000-000000000000" }, "13-error-and-recovery-states", "unknown-session");
  } finally {
    await page.close();
    child.kill();
    if (process.platform === "win32" && child.pid) spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
  }
}

// ---------------------------------------------------------------------------

try {
  if (!only || only === "reports") await captureReports();
  if (!only || only === "sandbox") await captureSandbox();
  if (!only || only === "inspector") await captureInspector();
  if (only === "inspector-overview") await captureInspector(true);
} finally {
  await browser.close();
}
fs.writeFileSync(path.join(OUT, `.captured-${only ?? "all"}.json`), JSON.stringify({ at: new Date().toISOString(), files: captured }, null, 2));
console.log(`\n${captured.length} screenshots written to ${OUT}`);
