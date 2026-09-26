# Architecture

## System Overview

Codebase Doctor is a **Bob-native application** — the Bob IDE is the frontend,
and a local MCP server is the backend. No separate web server is required.

```
┌─────────────────────────────────────────────────────────────┐
│                    Bob IDE (frontend)                       │
│                                                             │
│  • User interacts via natural language in agentic chat      │
│  • migration-doctor skill drives the workflow               │
│  • Plan mode renders the approvable migration plan          │
│  • Agent mode implements changes; todo list shows progress  │
│  • HTML artifact renders the final migration report         │
└────────────────────────┬────────────────────────────────────┘
                         │  MCP stdio (local)
┌────────────────────────▼────────────────────────────────────┐
│              Codebase Doctor MCP Server                     │
│              backend/  (Node.js / TypeScript ESM)           │
│                                                             │
│  analyze_dependency_usage      AST usage + API evidence     │
│  load_migration_requirements   knowledge base + docs        │
│  calculate_migration_blast_radius  risk scoring             │
│  generate_migration_plan       plan builder                 │
│  approve_migration_plan        records human approval       │
│  checkout_branch               git branch (approval-gated)  │
│  apply_migration_patch         install / transforms / manual│
│  verify_migration              deps + lint / test / build   │
│  run_checks                    internal raw check runner    │
│  generate_report               truthful report (md / html)  │
│  create_pull_request           GitHub API (verify-gated)    │
└────────────────────────┬────────────────────────────────────┘
                         │
          ┌──────────────┼──────────────┐
          │              │              │
   ┌──────▼──────┐ ┌─────▼─────┐ ┌────▼───────────┐
   │  Local disk  │ │  GitHub   │ │ Package manager│
   │  (cloned     │ │  REST API │ │ install (npm / │
   │   repo)      │ │  + git    │ │ yarn / pnpm)   │
   └─────────────┘ └───────────┘ └────────────────┘
```

---

## Technology Stack

| Layer | Technology | Why |
|---|---|---|
| MCP server | TypeScript (Node.js ESM) | Official MCP SDK; Bob can scaffold natively |
| MCP transport | stdio (local) | Zero latency; no network auth; hackathon-safe |
| AST analysis | `ts-morph` | Production-grade TS/JS AST without custom parsers; finds imports and concrete API usages |
| GitHub API | `@octokit/rest` | Official; handles rate limits + PR creation |
| Shell execution | Node `child_process` | Runs the repo's package-manager install and lint/test/build; git via `execFileSync` (no shell) |
| Session state | JSON files (`~/.codebase-doctor/sessions/`) | Survives Bob context resets |
| Knowledge base | JSON arrays (`backend/src/knowledge/`) | Seeded for demo; extensible |
| Bob skill | `SKILL.md` + supporting `.md` files | Procedural workflow; auto-activates on upgrade intent |

---

## Repository Structure

```
Codebase-Doctor/
├── README.md
├── .gitignore
├── .env.example
├── package.json                    ← root workspace
│
├── frontend/                       ← placeholder (Bob IDE is the UI for MVP)
│   └── README.md
│
├── backend/                        ← MCP server (TypeScript/Node.js ESM)
│   ├── src/
│   │   ├── index.ts                ← MCP server entry + tool registration
│   │   ├── types.ts                ← shared data models
│   │   ├── tools/                  ← one file per MCP tool (11 tools)
│   │   ├── lib/                    ← ast, ecosystem, risk, requirements, packages,
│   │   │                             transforms, git, github, session, project
│   │   └── knowledge/              ← JSON breaking-change knowledge base
│   └── test/
│       ├── unit/                   ← Vitest unit tests
│       ├── integration/            ← full pipeline on a disposable git copy
│       └── fixtures/               ← minimal React 17 app for tests
│
├── .bob/
│   ├── skills/migration-doctor/    ← custom Bob skill (SKILL.md + 2 supporting files)
│   ├── rules/AGENTS.md             ← general Bob rules
│   ├── rules-agent/AGENTS.md       ← agent-mode specific rules
│   └── mcp.example.json            ← MCP config template (copy to gitignored .bob/mcp.json)
│
├── docs/
│   ├── PROBLEM_SOLUTION.md         ← problem/solution write-up
│   ├── BOB_USAGE.md                ← Bob feature map
│   ├── ARCHITECTURE.md             ← this file
│   ├── DEMO_SCRIPT.md              ← 7-minute demo walkthrough
│   ├── BOB_USAGE_LOG.md            ← development session log
│   ├── IMPLEMENTATION_PLAN.md      ← original approved design plan (historical)
│   ├── target-repo.md
│   └── bob-evidence/
│       ├── fayaz/
│       │   ├── BOB_USAGE_LOG.md    ← timestamped session record
│       │   └── 0N-*.png            ← Bob session screenshots (real captures)
│       └── uzair/
│           ├── BOB_USAGE_LOG.md    ← teammate session record (empty until sessions are logged)
│           └── README.md
│
└── submission/
    ├── problem-solution.md         ← hackathon problem/solution statement
    ├── bob-statement.md            ← detailed Bob feature usage statement
    └── video-notes.md              ← demo video guide + recording checklist
```

---

## Data Flow

```
User input
    │
    ▼
Bob (migration-doctor skill activates)
    │
    ├─► analyze_dependency_usage
    │       git clone → AST scan of the package family (react + react-dom …)
    │       → import sites + concrete API usages (file/line/args)
    │       saved: session.json + analysis.json
    │
    ├─► load_migration_requirements
    │       canonical knowledge base (react-bc-*) validated/augmented by docs text
    │       → only rules with evidence in this repo (+ manual docs-* items)
    │       saved: requirements.json
    │
    ├─► calculate_migration_blast_radius
    │       evidence-based scoring (severity-guide.md) → BlastRadiusReport
    │       saved: analysis.json (updated)
    │
    ├─► generate_migration_plan  [Plan mode]
    │       deterministic step IDs, content-hashed planId → markdown for approval
    │       saved: migration-plan.json
    │
    ├─► approve_migration_plan   [after the user types "approved"]
    │       saved: migration-plan.json → approval { planId, approvedAt }
    │
    ├─► checkout_branch          [refuses without approval]
    │       git checkout -b codebase-doctor/<dep>-<version>-upgrade; base commit recorded
    │
    ├─► apply_migration_patch × N  [refuses without approval / off-branch]
    │       config: package.json (family) → install → lockfile → installed-version check
    │       codemod: transform → commit → residual re-scan
    │       manual/test: no edits → manual_required; later markManualComplete + note
    │
    ├─► verify_migration  [loop ≤ 3×]
    │       installed versions + lint + test + build → ChecksResult (with HEAD sha)
    │       saved: checks-result.json
    │
    ├─► generate_report
    │       markdown (PR body) + HTML (Bob artifact) from the same persisted data
    │
    └─► create_pull_request  [refuses unless approved + latest verify PASSED on HEAD]
            git push → GitHub API → PR URL (existing PR reused on retry)
```

---

## Session State

All state persists at `$CODEBASE_DOCTOR_HOME/sessions/<uuid>/` (default `~/.codebase-doctor`);
clones live in `$CODEBASE_DOCTOR_HOME/repos/<owner>/<repo>/<uuid>/`.

```
<uuid>/
├── session.json          ← repo info, upgrade info, phase, base commit, PR
├── analysis.json         ← AST usages (imports + API evidence) + blast radius
├── requirements.json     ← applicable breaking changes (+ docs validation)
├── migration-plan.json   ← steps with status/outcome + approval record
└── checks-result.json    ← latest dependency/lint/test/build result + HEAD sha
```

## Restart Behaviour

State on disk means Bob context resets are safe. Not every tool is idempotent,
so this is the exact behaviour on a repeated call:

| Tool | Re-call behaviour |
|---|---|
| `analyze_dependency_usage` | **Creates a new session** (new clone). Resume an existing one by reusing its sessionId. |
| `load_migration_requirements` | Recomputes; identical result is a no-op. Refuses to change requirements once the plan is approved. |
| `calculate_migration_blast_radius` | Deterministic; evidence is recomputed from scratch (no duplicates). |
| `generate_migration_plan` | Unchanged inputs → returns the existing plan (same step IDs, statuses, approval). Changed inputs → rebuilt only if no step has run; a different plan needs re-approval. |
| `approve_migration_plan` | Idempotent; returns the original approval. |
| `checkout_branch` | Switches to the existing branch; keeps the original base commit. |
| `apply_migration_patch` | Processed steps are skipped; a failed dependency install restores package.json/lockfile and leaves the step pending. |
| `verify_migration` / `run_checks` | Re-runs the checks (iteration counter increments). |
| `generate_report` | Read-only. |
| `create_pull_request` | Returns the recorded PR, or an already-open PR for the branch, instead of opening a duplicate. |

---

## Risk Scoring

Risk scores (0–100) are calculated by [`backend/src/lib/risk.ts`](../backend/src/lib/risk.ts)
using the rules documented in [`.bob/skills/migration-doctor/severity-guide.md`](../.bob/skills/migration-doctor/severity-guide.md).

| Score range | Tier | Action |
|---|---|---|
| 70–100 | High | Spawn dedicated `explore` subagent before patching |
| 40–69 | Medium | Apply directly with review |
| 1–39 | Low | Apply directly |
| 0 | None | Skip |

Scores are computed only from concrete API evidence: severity points per
breaking change found in the file (high 40 / medium 20 / low 10), plus +30 for a
non-test file that bootstraps the app root and +20 for a test file — see the
severity guide for the exact reference scores.
