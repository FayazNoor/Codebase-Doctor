# Architecture

## System Overview

Codebase Doctor is a **Bob-native application**: IBM Bob IDE is the user interface, and a local MCP server is
the backend. There is no separate web server. The only visual surface the product generates itself is the HTML
migration report, which Bob renders as an artifact and which also opens in any browser.

```
┌─────────────────────────────────────────────────────────────┐
│                    Bob IDE (user interface)                 │
│  • natural-language request in Agent mode                   │
│  • migration-doctor skill drives the workflow               │
│  • Plan mode presents the plan; the user types "approved"   │
│  • todo list shows progress; subagents read risky files     │
│  • create_html_artifact renders the migration report        │
└────────────────────────┬────────────────────────────────────┘
                         │  MCP over stdio
┌────────────────────────▼────────────────────────────────────┐
│          Codebase Doctor MCP server  (backend/, Node ESM)   │
│                                                             │
│  analyze_dependency_usage       clone · AST · peer preflight│
│  load_migration_requirements    knowledge base + docs       │
│  calculate_migration_blast_radius  evidence-based risk      │
│  generate_migration_plan        steps · content-hashed id   │
│  approve_migration_plan         records the human approval  │
│  checkout_branch                branch      (approval-gated)│
│  apply_migration_patch          install / codemod / manual  │
│                                 / skip / retry (gated)      │
│  verify_migration               versions + lint/test/build  │
│  run_checks                     internal raw check runner   │
│  generate_report                Markdown / HTML, any stage  │
│  create_pull_request            push + PR (approval+verify) │
│  get_session_status             recovery: sessions / next   │
└────────────────────────┬────────────────────────────────────┘
          ┌──────────────┼───────────────┬──────────────────┐
   ┌──────▼──────┐ ┌─────▼──────┐ ┌──────▼──────────┐ ┌─────▼─────┐
   │ session     │ │ GitHub API │ │ package manager │ │ npm       │
   │ clone + git │ │ + git push │ │ npm/yarn/pnpm   │ │ registry  │
   └─────────────┘ └────────────┘ └─────────────────┘ └───────────┘
                                                       (peer preflight,
                                                        optional/offline)
```

---

## Technology Stack

| Layer | Technology | Why |
|---|---|---|
| MCP server | TypeScript (Node.js ≥ 20, ESM), `@modelcontextprotocol/sdk` | Official SDK; zod schemas validate every tool input |
| Transport | stdio | Local, no network auth |
| AST analysis | `ts-morph` | TS/JS/JSX without custom parsers; import bindings, calls, member access, type positions |
| Versions / peer ranges | `semver` | Exact peer-range checks for the compatibility preflight |
| GitHub API | `@octokit/rest` | Repository metadata, PR lookup/creation (`GITHUB_API_URL` overridable) |
| Commands | `child_process` without shells for git; validated tokens for package managers | No injection from docs or repo content |
| Session state | JSON files, atomically written and HMAC-sealed | Survives Bob context resets; hand edits are detected |
| Knowledge base | JSON arrays (`backend/src/knowledge/`) | Declarative detect patterns per rule |
| Bob skill | `SKILL.md` + checklist + severity guide | Procedural workflow; auto-activates on upgrade intent |

---

## Repository Structure

```
Codebase-Doctor/
├── backend/
│   ├── src/
│   │   ├── index.ts                ← stdio entry point
│   │   ├── server.ts               ← createServer(): registration of the 12 tools
│   │   ├── types.ts                ← shared data model
│   │   ├── tools/                  ← one file per tool
│   │   ├── lib/
│   │   │   ├── ast.ts              ← family-wide usage scan (pre-filtered, fresh Project per call)
│   │   │   ├── compat.ts           ← peer-dependency preflight
│   │   │   ├── ecosystem.ts        ← package families, synced/type packages, curated companions
│   │   │   ├── git.ts / github.ts  ← clone, branch, commit, push; Octokit wrapper + error mapping
│   │   │   ├── integrity.ts        ← HMAC seals for session files
│   │   │   ├── output.ts           ← ANSI stripping, path hiding, failed-test parsing
│   │   │   ├── packages.ts         ← package.json edits, installs, installed-version checks
│   │   │   ├── report-html.ts      ← the migration report page
│   │   │   ├── requirements.ts     ← knowledge base + docs validation/augmentation
│   │   │   ├── risk.ts             ← evidence matching and scoring
│   │   │   ├── session.ts          ← sealed, atomic state files; approval gate
│   │   │   ├── transforms.ts       ← React 18 codemods
│   │   │   └── validation.ts       ← repository sources, package names, versions, branch names
│   │   └── knowledge/              ← react-17-to-18.json, express-4-to-5.json
│   ├── scripts/                    ← e2e-demo.mjs (real stdio run), github-sandbox.mjs
│   └── test/                       ← unit/, integration/, fixtures/
├── examples/react17-demo-app/      ← realistic React 17 app for end-to-end runs
├── scripts/screenshots/            ← capture.mjs → features-screen-shots/
├── .bob/                           ← skill, rules, MCP config template
└── docs/, submission/
```

---

## Data Flow

```
analyze_dependency_usage   validate url/dependency/version → clone into the session directory
                           (GitHub: shallow clone, token via env header; local path: cloned, untouched)
                           → package manager + scripts → AST scan of the family → peer preflight
                           saved: session.json, analysis.json   (rolled back if anything fails)

load_migration_requirements  knowledge base (canonical IDs) ± docs text (confirm / docs-N manual rules)
                           → only rules with evidence in this repo      saved: requirements.json

calculate_migration_blast_radius  evidence → per-file score → tiers   saved: analysis.json

generate_migration_plan    [peer-compat manual step] → dependencies step (family + types + curated
                           companions) → one step per rule (high severity first) → tests step
                           planId = hash(step ids, titles, files, types, package edits)
                           saved: migration-plan.json

approve_migration_plan     only with the user's literal "approved" and the current planId

checkout_branch            codebase-doctor/<dep>-<version>-upgrade; base commit recorded

apply_migration_patch      config:   edit package.json → install (lockfile) → installed-version check → commit
                           codemod:  transform → commit → residual re-scan
                           manual/test: no edits → manual_required → later markManualComplete + note (commit)
                           skip:     note required, never the dependency step
                           failure:  roll back the step's files, status "failed", output kept, retryable

verify_migration           installed versions + lint + test + build (the repo's own scripts, CI=true)
                           records HEAD, uncommitted files, failed tests    saved: checks-result.json,
                                                                                   checks-history.json

generate_report            ReportData from persisted state → Markdown (PR body) or HTML (artifact)

create_pull_request        gates: approval · no pending/failed step · latest verify passed on HEAD ·
                           clean tree · GitHub remote → push (never forced) → open PR (or reuse the open one)
```

---

## Session State

`$CODEBASE_DOCTOR_HOME` (default `~/.codebase-doctor`):

```
integrity.key                        ← per-installation HMAC key (created on first use, mode 0600)
sessions/<uuid>/
├── session.json          ← repo (source, owner/name, clone path, default branch), upgrade, phase,
│                            migration branch, base commit, pull request
├── analysis.json         ← usages (imports + API evidence), blast radius, peer compatibility, warnings
├── requirements.json     ← applicable breaking changes (+ docs validation)
├── migration-plan.json   ← steps with status/outcome (attempts, residuals, error output) + approval
├── checks-result.json    ← latest verification (HEAD sha, uncommitted files)
└── checks-history.json   ← every verification run, oldest first
repos/<owner|local>/<repo>/<uuid>/   ← the session's clone
```

Every file carries an HMAC `_seal` and is written via temp file + rename. A missing or mismatched seal raises an
integrity error: gates refuse to proceed, and the report shows the data as untrusted instead of using it.
`verify_migration` can always replace an untrusted `checks-result.json` with a genuine one.

## Restart Behaviour

| Tool | Re-call behaviour |
|---|---|
| `analyze_dependency_usage` | **Creates a new session** (new clone). Resume an existing one with its sessionId (`get_session_status` lists them). |
| `load_migration_requirements` | Recomputes; identical result is a no-op. Refuses to change requirements once the plan is approved. |
| `calculate_migration_blast_radius` | Deterministic; evidence is recomputed from scratch (no duplicates). |
| `generate_migration_plan` | Unchanged inputs → the existing plan (same IDs, statuses, approval). Changed inputs → rebuilt only if no step has run; a different plan needs re-approval. |
| `approve_migration_plan` | Idempotent; returns the original approval. |
| `checkout_branch` | Switches to the existing branch; keeps the original base commit. |
| `apply_migration_patch` | Processed steps are skipped; `failed` / `skipped` steps can be run again. |
| `verify_migration` / `run_checks` | Re-runs the checks (iteration increments; history kept). |
| `generate_report`, `get_session_status` | Read-only. |
| `create_pull_request` | Returns the recorded PR, or the already-open PR for the branch, instead of opening a duplicate; re-pushing the same commit is a no-op. |

---

## Risk Scoring

Scores (0–100) come from [`backend/src/lib/risk.ts`](../backend/src/lib/risk.ts), using the rules documented in
[`.bob/skills/migration-doctor/severity-guide.md`](../.bob/skills/migration-doctor/severity-guide.md).

| Score range | Tier | Action |
|---|---|---|
| 70–100 | High | Spawn a dedicated `explore` subagent before patching |
| 40–69 | Medium | Apply directly with review |
| 1–39 | Low | Apply directly |
| 0 | None | Skip |

Each distinct breaking change evidenced in a file adds its severity points: high 40, medium 20, low 10. On top of
that, +30 for a non-test file that bootstraps the app root, and +20 for a test file. Detect patterns can be limited
to TypeScript files or test files, and `api: "*"` matches any import of a module.

---

## Security Model

| Concern | Handling |
|---|---|
| Changes without consent | Approval is enforced in `session.ts`, and the plan ID is re-derived from the steps on every gate check |
| Faked results / statuses | HMAC-sealed state files; tampered data is rejected or labelled untrusted |
| Credentials | `GITHUB_TOKEN` is passed to git as a per-process env header (never argv or `.git/config`); redacted from errors; Octokit logging off |
| Command injection | git via argument arrays; package managers via allowlisted tokens (`cmd.exe /d /s /c` on Windows instead of `shell: true`) |
| Path traversal | Session IDs must be UUIDs; owner/repo names validated; clones live under the state directory |
| Untrusted repo/docs content | Data only: escaped in HTML, cell-escaped in Markdown (incl. @-mentions), never executed or followed as instructions |
| Running repository scripts | Verification runs the repo's own install/lint/test/build scripts — only use it on repositories you trust |
| Local paths in outputs | Clone paths are replaced with `<repo>` in check and install output |
