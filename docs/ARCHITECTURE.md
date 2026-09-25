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
│  analyze_dependency_usage      AST-level usage finder       │
│  load_migration_requirements   docs + knowledge base        │
│  calculate_migration_blast_radius  risk scoring             │
│  generate_migration_plan       plan builder                 │
│  verify_migration              lint / test / build loop     │
│  checkout_branch               git branch management        │
│  apply_migration_patch         targeted code transforms     │
│  create_pull_request           GitHub API (Octokit)         │
│  generate_report               before/after report          │
└────────────────────────┬────────────────────────────────────┘
                         │
          ┌──────────────┼──────────────┐
          │              │              │
   ┌──────▼──────┐ ┌─────▼─────┐ ┌────▼───────────┐
   │  Local disk  │ │  GitHub   │ │  npm registry  │
   │  (cloned     │ │  REST API │ │  (changelogs)  │
   │   repo)      │ │           │ │                │
   └─────────────┘ └───────────┘ └────────────────┘
```

---

## Technology Stack

| Layer | Technology | Why |
|---|---|---|
| MCP server | TypeScript (Node.js ESM) | Official MCP SDK; Bob can scaffold natively |
| MCP transport | stdio (local) | Zero latency; no network auth; hackathon-safe |
| AST analysis | `ts-morph` | Production-grade TS/JS AST without custom parsers |
| GitHub API | `@octokit/rest` | Official; handles rate limits + PR creation |
| Shell execution | Node `child_process` | Runs repo's own lint/test/build commands |
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
│   │   ├── tools/                  ← one file per MCP tool (10 tools)
│   │   ├── lib/                    ← git, AST, GitHub, session, risk helpers
│   │   └── knowledge/              ← JSON breaking-change knowledge base
│   └── test/
│       ├── unit/                   ← Vitest unit tests (14 tests)
│       └── fixtures/               ← minimal React 17 app for tests
│
├── .bob/
│   ├── skills/migration-doctor/    ← custom Bob skill (SKILL.md + 2 supporting files)
│   ├── rules/AGENTS.md             ← general Bob rules
│   └── rules-agent/AGENTS.md      ← agent-mode specific rules
│
├── docs/
│   ├── PROBLEM_SOLUTION.md         ← problem/solution write-up
│   ├── BOB_USAGE.md                ← Bob feature map
│   ├── ARCHITECTURE.md             ← this file
│   ├── DEMO_SCRIPT.md              ← 7-minute demo walkthrough
│   ├── IMPLEMENTATION_PLAN.md      ← full original design plan
│   ├── target-repo.md
│   └── bob-evidence/
│       ├── fayaz/
│       │   ├── BOB_USAGE_LOG.md    ← timestamped session record
│       │   └── *.png               ← Bob session screenshots
│       └── teammate/
│           ├── BOB_USAGE_LOG.md    ← timestamped session record
│           └── *.png               ← Bob session screenshots
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
    │       git clone → AST scan → DependencyUsage[]
    │       saved: session.json + analysis.json
    │
    ├─► load_migration_requirements
    │       PDF text / knowledge base → BreakingChange[]
    │       saved: requirements.json
    │
    ├─► calculate_migration_blast_radius
    │       risk scoring (severity-guide.md rules) → BlastRadiusReport
    │       saved: analysis.json (updated)
    │
    ├─► generate_migration_plan  [Plan mode]
    │       MigrationPlan → markdown for user approval
    │       saved: migration-plan.json
    │
    ├─► checkout_branch
    │       git checkout -b codebase-doctor/react-18-upgrade
    │
    ├─► apply_migration_patch × N  [per step]
    │       AST transforms + file writes + git commit
    │
    ├─► verify_migration  [loop ≤ 3×]
    │       lint + test + build → ChecksResult
    │       saved: checks-result.json
    │
    ├─► generate_report
    │       markdown (PR body) + HTML (Bob artifact)
    │
    └─► create_pull_request
            git push → GitHub API → PR URL
```

---

## Session State

All state persists at `~/.codebase-doctor/sessions/<uuid>/`:

```
<uuid>/
├── session.json          ← repo info, upgrade info, phase
├── analysis.json         ← AST usages + blast radius
├── requirements.json     ← applicable breaking changes
├── migration-plan.json   ← ordered migration steps
└── checks-result.json    ← latest lint/test/build output
```

State on disk means **Bob context resets are safe** — every tool is idempotent
and resumes from where the session left off.

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
