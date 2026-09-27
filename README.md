# Codebase Doctor 🩺

> AI-assisted dependency upgrade doctor powered by **IBM Bob 2.0**
> Built for the [lablab.ai IBM Bob 2.0 Hackathon](https://lablab.ai)

Codebase Doctor takes a repository, a dependency and a target version. It then:

1. analyses how the dependency's whole package family is used: import sites **and** concrete API calls, with file and line;
2. checks whether other packages' peer ranges would block the upgrade;
3. picks the breaking changes that actually apply to *this* repository and ranks files by risk;
4. writes a migration plan that a human must approve (enforced by the backend, not just requested);
5. applies the automatable changes on a branch, one commit per step;
6. verifies with the repository's own lint, test and build scripts against the newly installed versions;
7. opens a pull request whose report says exactly what was fixed automatically, what a human fixed, and what is still open.

**Golden path:** React 17 → 18 (`react` + `react-dom`, including `react-dom/client`, `react-dom/test-utils` and
`react-dom/server`). Express 4 → 5 rules exist and are manual/review only.

The user interface is **IBM Bob IDE**: the `migration-doctor` skill drives the workflow and Bob renders the HTML
migration report as an artifact. There is no separate web app; see [`frontend/README.md`](frontend/README.md).

🌐 **Live site:** [codebase-doctor-bob2.vercel.app](https://codebase-doctor-bob2.vercel.app): the 2-minute demo, and
[Try it](https://codebase-doctor-bob2.vercel.app/try/), a step-by-step replay of a recorded run with the real tool output.

📸 **Screenshots of every feature:** [`features-screen-shots/`](features-screen-shots/README.md)

---

## How it works

```
User (Bob, Agent mode):  "Upgrade react to 18.3.1 in <repo>"   (+ optional migration guide PDF)

Bob + migration-doctor skill → Codebase Doctor MCP server (12 tools)
  1. analyze_dependency_usage        clone, AST scan of the package family, peer-range preflight
  2. load_migration_requirements     built-in rules, validated/augmented by the attached docs
  3. calculate_migration_blast_radius evidence-based risk score per file
  4. generate_migration_plan         ordered steps, content-hashed planId           [Plan mode]
     user types "approved"      →    approve_migration_plan (backend-enforced gate)
  5. checkout_branch + apply_migration_patch × N
                                     install + lockfile, codemods, manual/skip/retry states
  6. verify_migration                installed versions + lint/test/build, fix loop ≤ 3
  7. generate_report + create_pull_request  (PR only after a passing check on the pushed commit)
  ·  get_session_status              recovery after a context reset: lists sessions / next action
```

---

## What is implemented (and verified)

| Area | Status | Evidence |
|---|---|---|
| MCP server, 12 tools, stdio | ✅ | protocol-level test (`test/integration/mcp-server.test.ts`), real stdio run |
| Repository input: GitHub URL (https/ssh, names with dots) **or** absolute local path (cloned, never modified) | ✅ | `validation.test.ts`, `lifecycle.test.ts` |
| Public repos without a token; actionable errors for 404 / 401 / 403 / rate limit / network | ✅ | `validation.test.ts` (mocked API errors) |
| React family AST analysis incl. type positions (`React.FC`), pre-filtered for large repos | ✅ | `ast.test.ts`, `detection.test.ts` |
| 12 React 17→18 rules from the official upgrade guide; 6 corrected Express 5 rules | ✅ | `detection.test.ts`, `requirements.test.ts` |
| User docs validate/augment rules without replacing canonical IDs | ✅ | `requirements.test.ts`, e2e run with the React 18 guide PDF |
| Peer-dependency preflight (lockfile → node_modules → npm registry → curated companions) | ✅ | `compat.test.ts`, e2e run |
| Risk scoring from concrete evidence (documented in the severity guide) | ✅ | `risk.test.ts` (reference scores asserted exactly) |
| Plan + approval bound to the exact plan content | ✅ | `workflow.test.ts`, `integrity.test.ts` |
| Transforms: `ReactDOM.render`/`hydrate` (default, namespace and named imports), `act` import | ✅ | `transforms.test.ts`, `detection.test.ts` |
| Honest step lifecycle: `applied`, `manual_required`, `completed_manual`, `skipped`, `failed` (rolled back, retryable), `not_applicable` | ✅ | `workflow.test.ts`, `lifecycle.test.ts` |
| Installs for npm / yarn / pnpm that work under `CI=true`; install-failure diagnosis | ✅ | `packages.test.ts`, `compat.test.ts`; real `npm install` in the e2e run |
| Verification against installed versions + lint/test/build; history of every run; refuses dirty trees | ✅ | `lifecycle.test.ts`; real Jest/ESLint/esbuild in the e2e run |
| Tamper-evident session state (hand-edited / "reconstructed" results are rejected) | ✅ | `integrity.test.ts`, e2e side session |
| Stage-aware HTML report (light/dark, responsive, accessible) + Markdown PR body | ✅ | `lifecycle.test.ts`, screenshots |
| Pull request: gates, idempotent retries, never force-pushes, body size cap | ✅ mocked + local sandbox | `create-pull-request.test.ts`, `git-remote.test.ts`, e2e sandbox |
| Real PR on github.com | ⏳ **not exercised** | needs a GitHub repo you own + `GITHUB_TOKEN`; see "Known limitations" |
| Real run inside Bob IDE with this version | ⏳ **not re-recorded** | earlier Bob sessions are in [`docs/bob-evidence/`](docs/bob-evidence/) |

### Verification results (2026-09-26, Node 24.15, Windows 11)

| Check | Result |
|---|---|
| `npm test` | **241 passed**, 0 failed, 0 skipped (222 unit + 19 integration, 17 files) |
| `npm run typecheck` / `npm run lint` / `npm run build` | clean |
| `npm audit --omit=dev` (runtime dependencies) | 0 vulnerabilities |
| End-to-end run (`backend/scripts/e2e-demo.mjs`) | 68 MCP calls over stdio against the demo app and a peer-conflict variant of it; see [`docs/evidence/e2e-run/`](docs/evidence/e2e-run/) |

The end-to-end run is real. It covered: a real `npm install` of React 18, and real Jest, ESLint and esbuild runs. The first verification failed because a lint rule flagged the deprecated `unmountComponentAtNode` and one test depended on intermediate renders that React 18 batches away. The second verification passed after the recorded manual fixes. The PR step ran against a **local sandbox** (mock GitHub API and a bare repository), not github.com.

---

## Quick start

### Prerequisites

- Node.js ≥ 20 and git ≥ 2.31
- IBM Bob IDE with Bob 2.0
- A GitHub Personal Access Token **only** for private repositories or to open pull requests
  (classic `repo` scope, or fine-grained Contents + Pull requests read/write)

### Setup

```bash
git clone https://github.com/FayazNoor/Codebase-Doctor
cd Codebase-Doctor
npm install              # npm workspaces — install from the repo root
npm run build            # → backend/dist/index.js

# Register the MCP server in Bob (project-level config, gitignored)
cp .bob/mcp.example.json .bob/mcp.json
#   edit: absolute path to backend/dist/index.js, and GITHUB_TOKEN if needed
```

The server reads configuration **only from environment variables** (it does not load `.env` files).
[`.env.example`](.env.example) documents `GITHUB_TOKEN`, `CODEBASE_DOCTOR_HOME` (state directory, default
`~/.codebase-doctor`), `GITHUB_API_URL`, `CODEBASE_DOCTOR_OFFLINE` and `CODEBASE_DOCTOR_PROJECT_URL`.

### Run (in Bob)

Open Bob IDE, start an Agent-mode conversation and say:

```
Upgrade react from 17 to 18.3.1 in https://github.com/<owner>/<react-17-repo>
Here are the React 18 migration docs: [attach the PDF, or leave it out]
```

The `migration-doctor` skill activates, runs analysis → rules → risk → plan, and **stops for your "approved"**
before anything in the repository changes. A ready-made React 17 app to try it on is in
[`examples/react17-demo-app/`](examples/react17-demo-app/README.md). Push it to a GitHub repository you own to demo
the pull request live, or pass its local path to analyse it directly.

### Run without Bob (reproducible end-to-end demo)

```bash
npm run e2e              # build + drive the real MCP server over stdio against examples/react17-demo-app
npm run screenshots      # regenerate features-screen-shots/ (needs Chrome; see scripts/screenshots/capture.mjs)
```

---

## Development

```bash
npm run build             # tsc → backend/dist/
npm test                  # all tests (unit + integration), no network
npm run test:integration  # integration tests only
npm run typecheck         # type-check without emitting
npm run lint              # eslint backend/src
```

Tests never touch the network or your real state: they use a temporary `CODEBASE_DOCTOR_HOME`, a fake package
manager (`setCommandRunner`), an in-memory registry (`setRegistryFetcher`), mocked GitHub calls, and local bare
repositories for push.

---

## Security model

- **Human approval is enforced by the backend.** Source-changing tools refuse without an approval that matches the
  current plan's content hash.
- **Session state is sealed.** An HMAC per file means a "fixed-up" verification result or step status is detected and
  reported as untrusted. It is tamper evidence, not a sandbox: a local user who reads the key could still forge it.
- **Credentials:** the token goes to git through a per-process environment header. It is never placed on the command
  line or in `.git/config`, and it is redacted from errors. Octokit logging is disabled. Screenshots and evidence
  contain no tokens.
- **Untrusted input:** repository content, docs text and command output are treated as data. Everything in the HTML
  report is escaped; Markdown table cells are escaped (pipes, HTML, @-mentions). Commands run as argument arrays
  with validated tokens.
- **Execution policy:** verification runs the repository's **own** `install`, `lint`, `test` and `build` scripts, as
  a developer would locally. Only use Codebase Doctor on repositories whose scripts you are willing to run.

---

## Known limitations

- Pull-request creation was verified with mocks and a local sandbox only. It was not run against github.com in
  this audit, because no GitHub repository and token were authorized for it.
- The Bob IDE workflow with this version has not been re-recorded. The screenshots show the MCP server through the
  official MCP Inspector (a generic MCP client) and the report artifact Bob renders.
- Monorepos (app not at the repository root), bun, and Yarn Plug'n'Play are not supported. They are rejected with a
  message.
- Automated transforms exist for `react-bc-1/2/3` only; other rules are manual or review items by design.
- Test tooling (vitest 2) has advisories that only apply when running Vitest's UI or Vite's dev server. The fix
  requires vitest 5, which needs Node ≥ 22, so it was not taken.

---

## Repository structure

```
Codebase-Doctor/
├── backend/                     ← MCP server (TypeScript / Node.js ESM)
│   ├── src/server.ts            ← tool registration (12 tools); index.ts starts stdio
│   ├── src/tools/               ← one file per tool
│   ├── src/lib/                 ← ast, compat, ecosystem, git, github, integrity, output, packages,
│   │                              report-html, requirements, risk, session, transforms, validation
│   ├── src/knowledge/           ← breaking-change rules (JSON)
│   ├── scripts/                 ← e2e-demo.mjs, github-sandbox.mjs
│   └── test/                    ← unit + integration (fixtures, no network)
├── examples/react17-demo-app/   ← realistic React 17 app used for the end-to-end run
├── .bob/                        ← migration-doctor skill, Bob rules, MCP config template
├── features-screen-shots/       ← screenshot library + index
├── scripts/screenshots/         ← capture script (Playwright + MCP Inspector)
├── scripts/site/                ← builds the site's report copies, replay data and hand-drawn sketches
├── site/                        ← project website (Vercel): landing page, Try-it replay, report snapshots
├── docs/                        ← architecture, demo script, evidence, Bob usage
└── submission/                  ← hackathon submission texts
```

## License

[MIT](LICENSE)
