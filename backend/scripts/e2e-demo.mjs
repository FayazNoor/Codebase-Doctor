#!/usr/bin/env node
/**
 * End-to-end run of the real Codebase Doctor MCP server against the React 17
 * demo app in examples/react17-demo-app — the same stdio protocol Bob uses.
 *
 * It exercises the whole workflow for real: clone, AST analysis, peer-range
 * preflight, rules (optionally validated by migration-guide text), blast
 * radius, plan, the approval gate, branch, a REAL `npm install` of React 18,
 * codemods, manual steps, REAL lint/test/build verification (which fails
 * first — React 18's automatic batching breaks a test — and passes after the
 * fix), reports at every stage, and the pull request.
 *
 * The script plays the human's part: it types "approved" and makes the manual
 * edits Bob would make in the IDE. Every such action is labelled
 * `actor: "demo script (in place of Bob / the user)"` in the transcript.
 *
 * Pull request: by default the demo repo has no GitHub remote, so
 * create_pull_request refuses (real behaviour). With --sandbox-pr, a local
 * GitHub API mock + bare repository stand in for GitHub (see
 * github-sandbox.mjs); nothing is sent to github.com.
 *
 * Usage (from backend/, after `npm run build`; needs network for npm install):
 *   node scripts/e2e-demo.mjs --out ../.demo-run [--sandbox-pr] [--docs guide.txt]
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import semver from "semver";
import { startGitHubSandbox } from "./github-sandbox.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const backend = path.resolve(here, "..");
const repoRoot = path.resolve(backend, "..");

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1];
};
const OUT = path.resolve(arg("--out") ?? path.join(repoRoot, ".demo-run"));
const SANDBOX = argv.includes("--sandbox-pr");
const DOCS = arg("--docs");
const SKIP_SIDE = argv.includes("--main-only");

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "reports"), { recursive: true });

const sh = (cwd, cmd, args) => execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();

// ---------------------------------------------------------------------------
// Demo repository (a fresh git repo seeded from examples/react17-demo-app)
// ---------------------------------------------------------------------------

const OWNER = "codebase-doctor-sandbox";
const REPO = "pantry-list";
const work = path.join(OUT, "work", REPO);
fs.cpSync(path.join(repoRoot, "examples", "react17-demo-app"), work, {
  recursive: true,
  filter: (src) => !/node_modules|[\\/]dist$/.test(src),
});
sh(work, "git", ["init", "-q", "-b", "main"]);
sh(work, "git", ["config", "user.email", "maintainer@pantry-list.invalid"]);
sh(work, "git", ["config", "user.name", "Pantry List Maintainer"]);
sh(work, "git", ["config", "core.autocrlf", "false"]);
sh(work, "git", ["add", "-A"]);
sh(work, "git", ["commit", "-q", "-m", "Pantry list on React 17"]);

let sandbox = null;
if (SANDBOX) {
  sandbox = await startGitHubSandbox({ owner: OWNER, repo: REPO, sourceRepo: work, dir: path.join(OUT, "github-sandbox") });
  sh(work, "git", ["remote", "add", "origin", `https://github.com/${OWNER}/${REPO}.git`]);
}

// ---------------------------------------------------------------------------
// MCP client over stdio (exactly how Bob launches the server)
// ---------------------------------------------------------------------------

const env = {
  ...process.env,
  CODEBASE_DOCTOR_HOME: path.join(OUT, "home"),
  ...(sandbox ? sandbox.env : { GITHUB_TOKEN: "" }),
};
const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(backend, "dist", "index.js")], env, stderr: "inherit" });
const client = new Client({ name: "codebase-doctor-e2e", version: "1.0.0" });
await client.connect(transport);

const transcript = [];
const HUMAN = "demo script (in place of Bob / the user)";

async function call(tool, args = {}, { expectError = false, label = null } = {}) {
  const started = Date.now();
  const result = await client.callTool({ name: tool, arguments: args }, undefined, { timeout: 30 * 60_000 });
  const text = result.content.map((c) => c.text).join("\n");
  const entry = { kind: "tool", tool, args: redactArgs(args), isError: Boolean(result.isError), ms: Date.now() - started, label, text };
  transcript.push(entry);
  const mark = result.isError ? "ERR" : "ok ";
  console.log(`[${mark}] ${tool}${label ? ` — ${label}` : ""} (${entry.ms} ms)`);
  if (Boolean(result.isError) !== expectError) {
    console.error(text);
    throw new Error(`${tool} ${expectError ? "should have failed" : "failed unexpectedly"}`);
  }
  return text;
}

function redactArgs(args) {
  const copy = { ...args };
  if (typeof copy.docsText === "string") copy.docsText = `<${copy.docsText.length} characters of migration-guide text>`;
  return copy;
}

function human(action, detail) {
  transcript.push({ kind: "human", actor: HUMAN, action, detail });
  console.log(`[you] ${action}`);
}

async function snapshot(sessionId, name) {
  const html = await call("generate_report", { sessionId, format: "html" }, { label: `report snapshot: ${name}` });
  fs.writeFileSync(path.join(OUT, "reports", `${name}.html`), html);
  transcript.at(-1).text = `<HTML report saved to reports/${name}.html — ${html.length} characters>`;
}

const edit = (rel, fn) => {
  const p = path.join(clonePath, rel);
  fs.writeFileSync(p, fn(fs.readFileSync(p, "utf8")));
};
let clonePath = "";

const stepId = (plan, key) => {
  const m = plan.match(new RegExp("`(step-\\d+-" + key.replace(/[-]/g, "\\-") + ")`"));
  if (!m) throw new Error(`no step for ${key} in plan`);
  return m[1];
};

// ---------------------------------------------------------------------------
// 1. Golden path
// ---------------------------------------------------------------------------

const t0 = Date.now();
const analysed = await call("analyze_dependency_usage", { url: work, dependency: "react", targetVersion: "18.3.1" }, { label: "analyse the React 17 demo app" });
const sessionId = analysed.match(/Session created: ([0-9a-f-]{36})/)[1];
clonePath = path.join(env.CODEBASE_DOCTOR_HOME, "repos", sandbox ? OWNER : "local", REPO, sessionId);
if (!fs.existsSync(path.join(clonePath, ".git"))) throw new Error(`session clone not found at ${clonePath}`);
await snapshot(sessionId, "01-analysed");

const docsText = DOCS ? fs.readFileSync(DOCS, "utf8") : undefined;
await call("load_migration_requirements", docsText ? { sessionId, docsText } : { sessionId }, { label: docsText ? "rules validated by the React 18 upgrade guide" : "built-in rules" });
await snapshot(sessionId, "02-rules-loaded");
await call("calculate_migration_blast_radius", { sessionId });
const plan = await call("generate_migration_plan", { sessionId });
const planId = plan.match(/Plan ID:\*\* `([0-9a-f]{12})`/)[1];
await snapshot(sessionId, "03-awaiting-approval");

await call("checkout_branch", { sessionId }, { expectError: true, label: "blocked: plan not approved" });
await call("apply_migration_patch", { sessionId, stepId: stepId(plan, "dependencies") }, { expectError: true, label: "blocked: plan not approved" });
human("replied to the plan: \"looks fine, but can you skip the tests?\"", "Not an approval — the tool must refuse it.");
await call("approve_migration_plan", { sessionId, planId, confirmation: "looks fine, but can you skip the tests?" }, { expectError: true, label: "refused: not an approval" });
human('replied to the plan: "approved"', "Explicit human approval of the plan shown above.");
await call("approve_migration_plan", { sessionId, planId, confirmation: "approved" });
await call("checkout_branch", { sessionId });

for (const key of ["dependencies", "react-bc-1", "react-bc-2", "react-bc-3"]) {
  await call("apply_migration_patch", { sessionId, stepId: stepId(plan, key) }, { label: key === "dependencies" ? "real npm install" : "automated transform" });
}
for (const key of ["react-bc-4", "react-bc-6", "react-bc-7", "react-bc-8", "react-bc-12", "tests"]) {
  await call("apply_migration_patch", { sessionId, stepId: stepId(plan, key) }, { label: "manual / review step" });
}
await call("apply_migration_patch", { sessionId, stepId: stepId(plan, "react-bc-1") }, { label: "re-run is a no-op" });
await snapshot(sessionId, "04-manual-work-open");

await call("verify_migration", { sessionId }, { label: "real lint/test/build — expected to fail" });
await snapshot(sessionId, "05-verification-failed");
await call("create_pull_request", { sessionId }, { expectError: true, label: "blocked: verification failed" });

// --- The manual work Bob / the developer does in the IDE ---------------------
human("react-bc-8: kept the root from createRoot and call root.unmount()", "src/legacy/toast.jsx");
edit("src/legacy/toast.jsx", (s) =>
  s
    .replace("import ReactDOM from 'react-dom';\n", "")
    .replace("createRoot(host).render(<Toast message={message} />);", "const root = createRoot(host);\n  root.render(<Toast message={message} />);")
    .replace("ReactDOM.unmountComponentAtNode(host);", "root.unmount();")
);
await call("apply_migration_patch", { sessionId, stepId: stepId(plan, "react-bc-8"), markManualComplete: true, note: "toast.jsx keeps the root returned by createRoot and calls root.unmount() instead of unmountComponentAtNode" });

human("react-bc-4: the SyncStatus test asserted on an intermediate render that React 18 batches away", "src/components/SyncStatus.test.jsx");
edit("src/components/SyncStatus.test.jsx", (s) =>
  s
    .replace("  // Every state the component rendered, in order.\n", "  // React 18 batches both updates in the promise callback into one render.\n")
    .replace("    { status: 'idle', syncedAt: '12:00' },\n", "")
);
await call("apply_migration_patch", { sessionId, stepId: stepId(plan, "react-bc-4"), markManualComplete: true, note: "Audited async setState: only SyncStatus updates state in a promise callback; its test now expects the single batched render" });

human("react-bc-12: configured the act environment for React 18", "jest.setup.js + package.json jest.setupFiles");
fs.writeFileSync(path.join(clonePath, "jest.setup.js"), "// React 18: tell React this is an act-aware test environment.\nglobalThis.IS_REACT_ACT_ENVIRONMENT = true;\n");
edit("package.json", (s) => {
  const pkg = JSON.parse(s);
  pkg.jest.setupFiles = ["<rootDir>/jest.setup.js"];
  return JSON.stringify(pkg, null, 2) + "\n";
});
await call("apply_migration_patch", { sessionId, stepId: stepId(plan, "react-bc-12"), markManualComplete: true, note: "Added jest.setup.js setting globalThis.IS_REACT_ACT_ENVIRONMENT = true (jest.setupFiles)" });

human("react-bc-7: removed the unstable_batchedUpdates wrapper (React 18 batches automatically)", "src/legacy/store.js");
edit("src/legacy/store.js", (s) =>
  s
    .replace("import ReactDOM from 'react-dom';\n\n", "")
    .replace(/\/\/ A tiny external store\.[\s\S]*?unstable_batchedUpdates\.\n/, "// A tiny external store. React 18 batches the subscriber updates automatically.\n")
    .replace("      ReactDOM.unstable_batchedUpdates(() => {\n        listeners.forEach((listener) => listener(state));\n      });", "      listeners.forEach((listener) => listener(state));")
);
await call("apply_migration_patch", { sessionId, stepId: stepId(plan, "react-bc-7"), markManualComplete: true, note: "Removed unstable_batchedUpdates from store.js; subscribers are notified directly" });

human("react-bc-6: audited effects for Strict Mode double-invocation", "no code change");
await call("apply_migration_patch", { sessionId, stepId: stepId(plan, "react-bc-6"), markManualComplete: true, note: "No component uses effects with external side effects; double-invoking is harmless" });
await call("apply_migration_patch", { sessionId, stepId: stepId(plan, "tests"), markManualComplete: true, note: "Test suite updated for React 18 (SyncStatus batching expectation, act environment)" });

await call("verify_migration", { sessionId }, { label: "real lint/test/build — after the fixes" });
await snapshot(sessionId, "06-verified");
const prBodyPreview = await call("generate_report", { sessionId, format: "markdown" }, { label: "markdown report (PR body)" });
fs.writeFileSync(path.join(OUT, "report.md"), prBodyPreview);

if (sandbox) {
  await call("create_pull_request", { sessionId }, { label: "sandbox GitHub (local mock API + bare repo)" });
  await call("create_pull_request", { sessionId }, { label: "retry is idempotent" });
  fs.writeFileSync(path.join(OUT, "pr.json"), JSON.stringify(sandbox.pulls, null, 2));
} else {
  await call("create_pull_request", { sessionId }, { expectError: true, label: "local repo without a GitHub remote" });
}
await call("get_session_status", { sessionId });
await snapshot(sessionId, "07-final");
const elapsedMain = Math.round((Date.now() - t0) / 1000);

// ---------------------------------------------------------------------------
// 2. Side sessions: failure and recovery states (all real tool behaviour)
// ---------------------------------------------------------------------------

let failedSession = null;
let tamperedSession = null;
if (!SKIP_SIDE) {
  // A library whose peer range stops at React 17. The preflight flags it; the user skips the warning;
  // the real install then fails, is rolled back and recorded as "failed"; after the fix the retry succeeds.
  // The release is picked from the registry at run time: the newest react-redux whose peer range accepts
  // React 17 but not 18.
  const packument = await (await fetch("https://registry.npmjs.org/react-redux", { headers: { Accept: "application/vnd.npm.install-v1+json" } })).json();
  const releases = Object.keys(packument.versions).filter((v) => semver.valid(v) && !semver.prerelease(v)).sort(semver.rcompare);
  const accepts = (v, r) => Boolean(packument.versions[v].peerDependencies?.react) && semver.satisfies(r, packument.versions[v].peerDependencies.react);
  const pinned = releases.find((v) => accepts(v, "17.0.2") && !accepts(v, "18.3.1"));
  const peerRepo = path.join(OUT, "work", "pantry-list-redux");
  fs.cpSync(work, peerRepo, { recursive: true, filter: (src) => !/[\\/]\.git([\\/]|$)/.test(src) });
  const peerPkgPath = path.join(peerRepo, "package.json");
  const peerPkg = JSON.parse(fs.readFileSync(peerPkgPath, "utf8"));
  peerPkg.dependencies["react-redux"] = pinned;
  peerPkg.dependencies["redux"] = "^4.2.1";
  fs.writeFileSync(peerPkgPath, JSON.stringify(peerPkg, null, 2) + "\n");
  execSync("npm install --package-lock-only --no-audit --no-fund", { cwd: peerRepo, stdio: "pipe" });
  sh(peerRepo, "git", ["init", "-q", "-b", "main"]);
  sh(peerRepo, "git", ["config", "user.email", "maintainer@pantry-list.invalid"]);
  sh(peerRepo, "git", ["config", "user.name", "Pantry List Maintainer"]);
  sh(peerRepo, "git", ["config", "core.autocrlf", "false"]);
  sh(peerRepo, "git", ["add", "-A"]);
  sh(peerRepo, "git", ["commit", "-q", "-m", `Pantry list on React 17 with react-redux ${pinned}`]);
  human(`prepared a variant of the demo app pinned to react-redux@${pinned}`, "peer range accepts React 17 but not 18 (picked from the npm registry)");

  const out = await call("analyze_dependency_usage", { url: peerRepo, dependency: "react", targetVersion: "18.3.1" }, { label: "side session: incompatible peer dependency" });
  failedSession = out.match(/Session created: ([0-9a-f-]{36})/)[1];
  const peerClone = path.join(env.CODEBASE_DOCTOR_HOME, "repos", "local", "pantry-list-redux", failedSession);
  await call("load_migration_requirements", { sessionId: failedSession });
  await call("calculate_migration_blast_radius", { sessionId: failedSession });
  const p2 = await call("generate_migration_plan", { sessionId: failedSession });
  human('replied to the plan: "approved"', "side session");
  await call("approve_migration_plan", { sessionId: failedSession, planId: p2.match(/Plan ID:\*\* `([0-9a-f]{12})`/)[1], confirmation: "approved" });
  await call("checkout_branch", { sessionId: failedSession });
  await call("apply_migration_patch", { sessionId: failedSession, stepId: stepId(p2, "dependencies") }, { expectError: true, label: "blocked: resolve the peer conflict first" });
  await call("apply_migration_patch", { sessionId: failedSession, stepId: stepId(p2, "peer-compat") }, { label: "peer step → manual_required" });
  human("skipped the peer-compatibility step: \"react-redux should work with React 18\"", "a wrong assumption — the install will prove otherwise");
  await call("apply_migration_patch", { sessionId: failedSession, stepId: stepId(p2, "peer-compat"), skip: true, note: "react-redux should work with React 18" }, { label: "skip with a reason" });
  await call("apply_migration_patch", { sessionId: failedSession, stepId: stepId(p2, "dependencies") }, { expectError: true, label: "real npm install fails (ERESOLVE)" });
  await call("get_session_status", { sessionId: failedSession });
  await snapshot(failedSession, "08-step-failed");

  const suggestion = p2.match(/react-redux@[^`]*` \(peer react [^)]*\) → try `(\^\d+\.\d+\.\d+)`/)?.[1];
  if (!suggestion) throw new Error("the plan did not suggest a compatible react-redux release");
  human(`upgraded react-redux to ${suggestion} in package.json (the version the plan suggested)`, "package.json on the migration branch");
  const clonePkgPath = path.join(peerClone, "package.json");
  const clonePkg = JSON.parse(fs.readFileSync(clonePkgPath, "utf8"));
  clonePkg.dependencies["react-redux"] = suggestion;
  fs.writeFileSync(clonePkgPath, JSON.stringify(clonePkg, null, 2) + "\n");
  await call("apply_migration_patch", { sessionId: failedSession, stepId: stepId(p2, "peer-compat"), markManualComplete: true, note: `react-redux ${pinned} → ${suggestion} (peer range includes React 18)` }, { label: "skipped step completed after all" });
  await call("apply_migration_patch", { sessionId: failedSession, stepId: stepId(p2, "dependencies") }, { label: "retry: real npm install succeeds (attempt 2)" });
  await snapshot(failedSession, "10-step-retried");

  // A verification result written by hand is rejected (the dry-run incident).
  const out3 = await call("analyze_dependency_usage", { url: work, dependency: "react", targetVersion: "18.3.1" }, { label: "side session: hand-written verification" });
  tamperedSession = out3.match(/Session created: ([0-9a-f-]{36})/)[1];
  await call("load_migration_requirements", { sessionId: tamperedSession });
  await call("calculate_migration_blast_radius", { sessionId: tamperedSession });
  await call("generate_migration_plan", { sessionId: tamperedSession });
  human("wrote checks-result.json by hand (\"reconstructed\")", "exactly what happened in the earlier dry run");
  fs.writeFileSync(
    path.join(env.CODEBASE_DOCTOR_HOME, "sessions", tamperedSession, "checks-result.json"),
    JSON.stringify({ iteration: 1, timestamp: new Date().toISOString(), headCommit: null, dependencies: { status: "passed", installed: {}, output: "" }, lint: { status: "skipped", command: null, output: "" }, test: { status: "skipped", command: null, output: "", failedTests: [] }, build: { status: "passed", command: "npm run build", output: "" }, allPassed: true, failureSummary: null })
  );
  await call("get_session_status", { sessionId: tamperedSession }, { label: "integrity check reported" });
  await snapshot(tamperedSession, "09-verification-untrusted");

  // Input errors
  await call("analyze_dependency_usage", { url: "https://gitlab.com/acme/shop", dependency: "react", targetVersion: "18" }, { expectError: true, label: "unsupported host" });
  await call("analyze_dependency_usage", { url: work, dependency: "react", targetVersion: "latest" }, { expectError: true, label: "dist-tag instead of a version" });
  await call("analyze_dependency_usage", { url: work, dependency: "react", targetVersion: "18.99.0" }, { expectError: true, label: "version that was never published" });
  await call("analyze_dependency_usage", { url: work, dependency: "vue", targetVersion: "3" }, { expectError: true, label: "dependency not declared" });
  await call("analyze_dependency_usage", { url: path.join(work, "src"), dependency: "react", targetVersion: "18" }, { expectError: true, label: "not a git repository" });
  if (sandbox) {
    await call("analyze_dependency_usage", { url: `https://github.com/${OWNER}/does-not-exist`, dependency: "react", targetVersion: "18" }, { expectError: true, label: "repository not found (sandbox API 404)" });
  }
  await call("get_session_status", {}, { label: "list sessions" });
}

await client.close();
if (sandbox) await sandbox.close();

// ---------------------------------------------------------------------------
// Transcript
// ---------------------------------------------------------------------------

const summary = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  sandboxPr: SANDBOX,
  docsSupplied: Boolean(docsText),
  mainSessionId: sessionId,
  failedSessionId: failedSession,
  tamperedSessionId: tamperedSession,
  mainWorkflowSeconds: elapsedMain,
  toolCalls: transcript.filter((e) => e.kind === "tool").length,
  toolErrors: transcript.filter((e) => e.kind === "tool" && e.isError).length,
  humanActions: transcript.filter((e) => e.kind === "human").length,
};
fs.writeFileSync(path.join(OUT, "transcript.json"), JSON.stringify({ summary, transcript }, null, 2));
const md = [
  `# Codebase Doctor — end-to-end transcript`,
  ``,
  "```json",
  JSON.stringify(summary, null, 2),
  "```",
  ``,
  ...transcript.map((e, i) =>
    e.kind === "human"
      ? `### ${i + 1}. 👤 ${e.actor}: ${e.action}\n\n${e.detail}\n`
      : `### ${i + 1}. \`${e.tool}\`${e.label ? ` — ${e.label}` : ""} ${e.isError ? "(tool error)" : ""}\n\nargs: \`${JSON.stringify(e.args)}\` · ${e.ms} ms\n\n\`\`\`text\n${e.text}\n\`\`\`\n`
  ),
].join("\n");
fs.writeFileSync(path.join(OUT, "transcript.md"), md);
console.log(`\nDone in ${Math.round((Date.now() - t0) / 1000)} s — ${summary.toolCalls} tool calls. Output: ${OUT}`);
