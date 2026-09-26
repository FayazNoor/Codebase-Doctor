# IMPLEMENTATION_PLAN.md

> **Project:** Codebase Doctor — AI-Assisted Dependency Upgrade Doctor  
> **Hackathon:** IBM Bob 2.0 @ lablab.ai  
> **Team:** 2 developers  
> **Status:** Original approved implementation plan (historical — preserved as written before implementation)
> **Current status:** see [`README.md`](../README.md#current-status) and the Bob usage logs
> ([`docs/BOB_USAGE_LOG.md`](BOB_USAGE_LOG.md), [`docs/bob-evidence/`](bob-evidence/)).
> Notable later changes: 11 MCP tools (added `approve_migration_plan`), knowledge base is JSON
> (`backend/src/knowledge/*.json`), MCP config lives in `.bob/mcp.json`, and the demo target
> repository still needs preparation (see [`docs/target-repo.md`](target-repo.md)).

---

## Table of Contents

1. [Problem & Solution Summary](#1-problem--solution-summary)
2. [Product Architecture](#2-product-architecture)
3. [Frontend / Backend Architecture](#3-frontend--backend-architecture)
4. [Repository Structure](#4-repository-structure)
5. [Data Models](#5-data-models)
6. [GitHub Integration Design](#6-github-integration-design)
7. [MCP Server Design](#7-mcp-server-design)
8. [Bob Skill Design](#8-bob-skill-design)
9. [Bob Workflow Design](#9-bob-workflow-design)
10. [Demo Scenario](#10-demo-scenario)
11. [Testing Strategy](#11-testing-strategy)
12. [Deployment Strategy](#12-deployment-strategy)
13. [Implementation Phases](#13-implementation-phases)
14. [Task Split — Two Developers](#14-task-split--two-developers)
15. [Hackathon Risks & Scope Cuts](#15-hackathon-risks--scope-cuts)

---

## 1. Problem & Solution Summary

### Problem

Upgrading a major dependency in an unfamiliar repository is one of the most
high-friction engineering tasks: it requires manual archaeology (where is it
used?), reading migration docs, estimating blast radius, making targeted code
changes, generating regression tests, running builds, and debugging failures —
before a PR can be opened. This easily takes a senior engineer days.

### Solution

**Codebase Doctor** is a Bob-powered agentic application that takes a GitHub
repo URL, a dependency name, and a target version, then autonomously:

1. Clones and indexes the repo
2. Finds every usage of the dependency
3. Reads and understands migration documentation (user-supplied or auto-fetched)
4. Identifies only the breaking changes that apply to THIS repo
5. Produces a risk-ranked migration plan and shows it to the user
6. On approval, implements the changes on a new branch
7. Generates or updates tests
8. Runs lint / test / build and iterates on failures
9. Runs a final code review
10. Opens a pull request with a detailed before/after migration report

### MVP Constraint

Single excellent end-to-end migration: **React 17 → 18** (or **Express 4 → 5**)
on a well-known public repository (chosen for the demo).

---

## 2. Product Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      User (Bob IDE)                             │
│                                                                 │
│  1. Paste repo URL + dep + version + (optional) migration docs  │
│  2. Review & approve migration plan (Plan mode output)          │
│  3. Monitor parallel implementation (Agent mode subagents)      │
│  4. Review final PR diff and migration report                   │
└────────────────────────┬────────────────────────────────────────┘
                         │  Bob Agent (orchestrator)
                         │
          ┌──────────────┼──────────────┐
          │              │              │
   ┌──────▼──────┐ ┌────▼────┐ ┌──────▼──────┐
   │  Subagent:  │ │Subagent:│ │  Subagent:  │
   │  Repo       │ │ Docs    │ │  Test       │
   │  Analyst    │ │ Analyst │ │  Generator  │
   └──────┬──────┘ └────┬────┘ └──────┬──────┘
          │              │              │
          └──────────────┼──────────────┘
                         │
               ┌─────────▼──────────┐
               │  Codebase Doctor   │
               │    MCP Server      │
               │  (local stdio)     │
               └─────────┬──────────┘
                         │
          ┌──────────────┼──────────────┐
          │              │              │
   ┌──────▼──────┐ ┌────▼────┐ ┌──────▼──────┐
   │  GitHub     │ │ Repo    │ │  Migration  │
   │  API        │ │ Runner  │ │  Knowledge  │
   │  (Octokit)  │ │ (shell) │ │  Cache      │
   └─────────────┘ └─────────┘ └─────────────┘
```

### Key Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Orchestration | Bob Agent mode | Native Bob capability; fulfills hackathon requirement |
| Analysis phase | Bob Plan mode | Produces approvable structured plan; fulfills requirement |
| Heavy repo work | Subagents (explore type) | Keeps main context lean; reduces Bobcoin burn |
| Doc ingestion | Bob file attachment (PDF/docx) + MCP tool | Fulfills document-understanding requirement |
| Repo execution | MCP server (local stdio) | Sandboxed shell; reusable as standalone tool |
| State between phases | JSON files on disk (session dir) | Simple, survives context resets |

---

## 3. Frontend / Backend Architecture

Codebase Doctor is a **Bob-native** application — there is no separate web UI.
The "frontend" is the Bob IDE agentic chat. The "backend" is the MCP server
exposed as a local stdio process.

```
┌─────────────────────────────────────────────────────────────────┐
│                      Bob IDE (frontend)                         │
│                                                                 │
│  • User interacts via natural language in agentic chat          │
│  • Plan mode renders approvable migration plan (Markdown)       │
│  • Agent mode drives implementation; todo list shows progress   │
│  • Subagent breadcrumbs show parallel workstreams               │
│  • Final report rendered as create_html_artifact one-pager      │
└──────────────────────────┬──────────────────────────────────────┘
                           │  MCP tool calls (stdio)
┌──────────────────────────▼──────────────────────────────────────┐
│                  Codebase Doctor MCP Server                     │
│                  (Node.js / TypeScript, local)                  │
│                                                                 │
│  Tools exposed:                                                 │
│    analyze_dependency_usage          AST usage finder + session │
│    load_migration_requirements       docs ingestion + mapping   │
│    calculate_migration_blast_radius  risk-ranked file report    │
│    generate_migration_plan           plan JSON + markdown       │
│    verify_migration                  lint / test / build loop   │
│    checkout_branch                   git branch management      │
│    apply_migration_patch             targeted code change       │
│    create_pull_request               open PR via GitHub API     │
│    generate_report                   before/after diff report   │
└──────────────────────────┬──────────────────────────────────────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
   ┌──────────▼───┐  ┌─────▼──────┐  ┌─▼──────────────┐
   │  Local disk   │  │  GitHub    │  │  npm registry  │
   │  (cloned repo)│  │  REST API  │  │  (changelogs)  │
   └───────────────┘  └────────────┘  └────────────────┘
```

### Technology Stack

| Layer | Technology | Why |
|---|---|---|
| MCP server language | TypeScript (Node.js) | Official MCP SDK; Bob can scaffold it natively |
| MCP transport | stdio (local) | Zero network overhead; works offline; hackathon-safe |
| AST analysis | `ts-morph` (TS repos) / `@babel/parser` (JS) | Production-grade AST without custom parsers |
| GitHub API | `@octokit/rest` | Official; handles auth, rate limits, PR creation |
| Shell execution | Node `child_process` (sandboxed cwd) | Run repo's own lint/test/build commands |
| Session state | JSON files in `~/.codebase-doctor/sessions/` | Survives Bob context resets |
| Migration knowledge | Structured JSON + markdown in `knowledge/` dir | Seeded for demo; extensible |

---

## 4. Repository Structure

```
codebase-doctor/
├── docs/
│   └── IMPLEMENTATION_PLAN.md          ← this file
│
├── backend/                            ← the MCP server package
│   ├── src/
│   │   ├── index.ts                    ← MCP server entry point & tool registration
│   │   ├── tools/
│   │   │   ├── analyze-dependency-usage.ts
│   │   │   ├── load-migration-requirements.ts
│   │   │   ├── calculate-migration-blast-radius.ts
│   │   │   ├── generate-migration-plan.ts
│   │   │   ├── verify-migration.ts
│   │   │   ├── checkout-branch.ts
│   │   │   ├── apply-migration-patch.ts
│   │   │   ├── run-checks.ts
│   │   │   ├── create-pull-request.ts
│   │   │   └── generate-report.ts
│   │   ├── lib/
│   │   │   ├── git.ts                  ← git helpers (clone, branch, commit, push)
│   │   │   ├── ast.ts                  ← AST traversal helpers
│   │   │   ├── github.ts               ← Octokit wrapper
│   │   │   ├── session.ts              ← session state read/write
│   │   │   └── risk.ts                 ← blast-radius scoring algorithm
│   │   └── knowledge/
│   │       ├── react-17-to-18.md       ← seeded migration knowledge for demo
│   │       └── express-4-to-5.md
│   ├── package.json
│   ├── tsconfig.json
│   └── README.md
│
├── .bob/                               ← Bob configuration (in project root)
│   ├── skills/
│   │   └── migration-doctor/
│   │       ├── SKILL.md                ← skill activation instructions + Bob workflow steps
│   │       ├── migration-checklist.md  ← canonical step checklist Bob follows
│   │       └── severity-guide.md       ← risk scoring reference for blast-radius analysis
│   ├── rules/
│   │   └── AGENTS.md                   ← general Bob rules for this repo
│   └── rules-agent/
│       └── AGENTS.md                   ← agent-mode rules (MCP tool names + patterns)
│
├── demo/
│   ├── target-repo.md                  ← the repo used for live demo + why it was chosen
│   └── walkthrough-script.md           ← presenter talking points
│
└── package.json                        ← root (workspaces if needed)
```

---

## 5. Data Models

All state is written to `~/.codebase-doctor/sessions/<session-id>/`.

### `session.json` — top-level session record

```ts
interface Session {
  id: string;                    // uuid
  createdAt: string;             // ISO timestamp
  repo: {
    url: string;                 // e.g. "https://github.com/owner/repo"
    owner: string;
    name: string;
    localPath: string;           // absolute path on disk after clone
    defaultBranch: string;
  };
  upgrade: {
    dependency: string;          // e.g. "react"
    fromVersion: string;         // detected from package.json
    toVersion: string;           // user-supplied target
  };
  migrationBranch: string;       // e.g. "codebase-doctor/react-18-upgrade"
  phase: SessionPhase;           // see below
}

type SessionPhase =
  | "analyzing"
  | "plan_ready"
  | "plan_approved"
  | "implementing"
  | "checks_running"
  | "checks_passed"
  | "pr_open"
  | "complete";
```

### `analysis.json` — repo analysis output

```ts
interface AnalysisResult {
  repoLanguage: "typescript" | "javascript" | "mixed";
  packageManager: "npm" | "yarn" | "pnpm";
  testFramework: string | null;       // e.g. "jest", "vitest"
  buildCommand: string | null;
  lintCommand: string | null;
  testCommand: string | null;
  dependencyUsages: DependencyUsage[];
  blastRadius: BlastRadiusReport;
}

interface DependencyUsage {
  file: string;                       // relative path
  line: number;
  column: number;
  importSpecifier: string;            // what was imported
  usageContext: string;               // 1-line snippet
  riskScore: number;                  // 0–100
  breakingChangeIds: string[];        // references into migration knowledge
}

interface BlastRadiusReport {
  totalFiles: number;
  affectedFiles: number;
  riskDistribution: { high: number; medium: number; low: number };
  topAffectedFiles: Array<{ file: string; riskScore: number; reason: string }>;
}
```

### `migration-plan.json` — plan produced in Plan mode

```ts
interface MigrationPlan {
  summary: string;
  estimatedEffort: "low" | "medium" | "high";
  breakingChanges: BreakingChange[];
  steps: MigrationStep[];
}

interface BreakingChange {
  id: string;
  description: string;
  affectedFiles: string[];
  automatable: boolean;
  codemods: string[];                 // npm package names if available
}

interface MigrationStep {
  order: number;
  title: string;
  description: string;
  files: string[];
  changeType: "codemod" | "manual" | "config" | "test";
  approved: boolean;
}
```

### `checks-result.json` — lint / test / build output

```ts
interface ChecksResult {
  iteration: number;
  timestamp: string;
  lint: { passed: boolean; output: string };
  test: { passed: boolean; output: string; failedTests: string[] };
  build: { passed: boolean; output: string };
  allPassed: boolean;
  failureSummary: string | null;      // Bob's diagnosis for next iteration
}
```

---

## 6. GitHub Integration Design

### Authentication

- User provides a GitHub Personal Access Token (PAT) with `repo` scope at
  session start; stored in `~/.codebase-doctor/.env` (never committed).
- The MCP server reads it via environment variable `GITHUB_TOKEN`.

### Operations

| Operation | API / mechanism | Notes |
|---|---|---|
| Clone repo | `git clone` (shell) | HTTPS with token in URL |
| Detect default branch | `GET /repos/{owner}/{repo}` | `default_branch` field |
| Create migration branch | `git checkout -b` (shell) | Naming: `codebase-doctor/{dep}-{version}-upgrade` |
| Push branch | `git push origin <branch>` (shell) | |
| Create pull request | `POST /repos/{owner}/{repo}/pulls` | Includes full migration report in PR body |
| Add PR labels | `POST /repos/{owner}/{repo}/issues/{issue_number}/labels` | Adds `codebase-doctor`, `dependencies` |

### PR Body Template

The PR body is generated by the `generate_report` MCP tool and includes:

- Executive summary (1 paragraph)
- Dependency being upgraded and versions
- Blast radius statistics (table)
- Breaking changes addressed (checklist)
- Files changed (grouped by risk level)
- Test results before / after (pass/fail counts)
- Bobcoin cost of the migration (productivity metric for hackathon judges)

---

## 7. MCP Server Design

### Transport

Local **stdio** — started by Bob IDE via the `mcp` configuration block in
`.bob/settings.json`. No network port required.

```json
{
  "mcpServers": {
    "codebase-doctor": {
      "command": "node",
      "args": ["./backend/dist/index.js"],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      }
    }
  }
}
```

### Tool Registry (v2 API)

All tools registered with `registerTool(name, description, schema, handler)`.

The five **core analysis tools** map directly to the `migration-doctor` skill's
workflow phases. The remaining tools handle implementation mechanics.

| Tool | Input | Output | Skill phase |
|---|---|---|---|
| `analyze_dependency_usage` | `{ url, dependency, targetVersion }` | `Session` + `AnalysisResult` saved to disk; returns usage summary | Phase 1 — Analyse |
| `load_migration_requirements` | `{ sessionId, docsText? }` | Structured `BreakingChange[]` keyed by applicability to this repo | Phase 2 — Requirements |
| `calculate_migration_blast_radius` | `{ sessionId }` | `BlastRadiusReport` with risk-ranked file list | Phase 3 — Blast radius |
| `generate_migration_plan` | `{ sessionId }` | `MigrationPlan` written to disk; returns Markdown summary | Phase 4 — Plan |
| `verify_migration` | `{ sessionId }` | `ChecksResult`; runs lint + test + build; returns pass/fail + diagnosis | Phase 5 — Verify |
| `checkout_branch` | `{ sessionId }` | branch name string | — |
| `apply_migration_patch` | `{ sessionId, stepId }` | diff string of changes made | — |
| `run_checks` | `{ sessionId }` | `ChecksResult` (raw; `verify_migration` is the skill-facing wrapper) | — |
| `create_pull_request` | `{ sessionId }` | PR URL string | — |
| `generate_report` | `{ sessionId }` | Full Markdown + HTML report string | — |

### Design Principles

- **Tools are thin** — they do I/O and call `lib/` helpers; no logic in
  `index.ts`.
- **Idempotent** — every tool can be called again safely (re-entrant); session
  state tracks what has been done.
- **Output is compact** — tools return concise summaries rather than raw file
  dumps; Bob subagents fetch detail if needed. This keeps main context small.
- **Error messages are actionable** — tool errors include what failed and a
  suggested next step (Bob uses these directly in its reasoning).

---

## 8. Bob Skill Design

The `migration-doctor` skill is a **workspace skill** stored at
`.bob/skills/migration-doctor/SKILL.md`. It activates automatically whenever
a user asks to upgrade, migrate, or bump a dependency — no slash command
required (though `/migration-doctor` also works).

### Why a Skill (not just an AGENTS.md rule)?

| Skill | AGENTS.md rule |
|---|---|
| Self-contained procedural workflow with named steps | Short, always-active context injection |
| Carries its own supporting reference files | No supporting files |
| Can instruct Bob to load the checklist and severity guide on demand | Would inline everything into every context |
| Auto-activates only when migration intent is detected | Always present (Bobcoin overhead) |

The skill keeps the main context lean: `migration-checklist.md` and
`severity-guide.md` are **read by Bob only when the relevant step runs**,
not loaded upfront.

### Skill File Purposes

| File | Purpose |
|---|---|
| `SKILL.md` | Procedural steps Bob follows; maps each phase to the exact MCP tool to call; instructs Bob when to spawn subagents and when to switch modes |
| `migration-checklist.md` | Canonical ordered checklist of every action in a migration; Bob renders this as the live todo list during Phase 3 implementation |
| `severity-guide.md` | Reference table for risk scoring (high / medium / low) used by `calculate_migration_blast_radius`; Bob reads this when reviewing the blast-radius output |

### Skill Activation Triggers (description field)

```
Use when the user wants to upgrade, migrate, bump, or update a dependency or
package to a new version — guides the full Codebase Doctor workflow from
analysis through PR creation.
```

### Skill → MCP Tool Mapping

```
SKILL.md Phase          MCP tool called
─────────────────────   ──────────────────────────────────
Phase 1  Analyse        analyze_dependency_usage
Phase 2  Requirements   load_migration_requirements
Phase 3  Blast radius   calculate_migration_blast_radius
Phase 4  Plan           generate_migration_plan   [→ Plan mode switch]
Phase 5  Verify         verify_migration           [→ iterative loop]
Phase 6  PR             create_pull_request + generate_report
```

---

## 9. Bob Workflow Design

This section describes how Bob's capabilities are used in the user-facing
flow. This is the central differentiator for hackathon judging.

### Phase 0 — Kickoff (Agent mode, main context)

```
User → Bob (Agent mode):
  "Upgrade react from 17 to 18 in https://github.com/owner/repo.
   Here are the React 18 migration docs: [attached PDF]"
```

The `migration-doctor` **skill auto-activates** and guides Bob through the
following phases. Bob calls `analyze_dependency_usage` first to bootstrap the
session. The PDF is parsed natively by Bob's document-understanding capability
(`.pdf` attachment via context mention) and its text passed to
`load_migration_requirements`.

**Bob features demonstrated:** Skill auto-activation, Agent mode, document
understanding (PDF), MCP tool invocation.

### Phase 1 — Analysis (Parallel subagents, explore type)

Bob spawns **two subagents in parallel** to keep the main context clean:

```
Subagent A (explore):  "Call analyze_dependency_usage for session {id}.
                        Return a bullet list of the 10 highest-risk files
                        and why, reading severity-guide.md for scoring rules."

Subagent B (explore):  "Call load_migration_requirements for session {id}.
                        Return a structured list of breaking changes with
                        automatable vs. manual flags."
```

Both return compact summaries. Bob merges them in the main context.

**Bob features demonstrated:** Parallel subagents, background tasks,
context efficiency (subagents read `severity-guide.md`; main context does not).

### Phase 2 — Blast Radius + Plan (Plan mode)

Bob calls `calculate_migration_blast_radius`, then **switches to Plan mode**
and calls `generate_migration_plan`. The skill instructs Bob to read
`migration-checklist.md` to validate step completeness before rendering the
plan. The plan is rendered as formatted Markdown in chat for user review.

```
Bob (Plan mode):
  [reads migration-checklist.md to validate all steps are covered]
  [calls generate_migration_plan → writes migration-plan.json]
  "Here is the prioritised migration plan..."
```

User reviews the plan and types "approved" (or requests changes).

**Bob features demonstrated:** Plan mode, skill-driven checklist validation,
approvable plan, structured output.

### Phase 3 — Implementation (Agent mode, subagents per risk tier)

On approval, Bob switches back to Agent mode. The skill's `migration-checklist.md`
is used as the todo list template. For **high-risk files** Bob spawns an
`explore` subagent per file cluster (max 3 in parallel); low-risk files are
applied directly.

For each `MigrationStep`:
1. Call `checkout_branch` (once)
2. Spawn subagent: read files in the step's file list → return current
   patterns that need changing
3. Call `apply_migration_patch` with the subagent's analysis
4. Tick item in todo list

**Bob features demonstrated:** Agent mode, targeted subagents, skill-driven
todo list progress tracking.

### Phase 4 — Verify Loop (Agent mode)

```
loop (max 3 iterations):
  call verify_migration(sessionId)    ← skill-facing wrapper over run_checks
  if allPassed → break
  spawn subagent (general): "Diagnose these test/lint failures and
    propose minimal fixes: {failureSummary}"
  apply subagent-proposed fixes
```

**Bob features demonstrated:** Iterative agentic loop, subagent-for-diagnosis.

### Phase 5 — Code Review & PR (Agent mode)

Bob performs a self-directed code review by spawning one final subagent with
`fork_context: true` (so it has the full session history) to review the diff.

Then:
- Calls `generate_report` → produces the before/after HTML report artifact
- Calls `create_pull_request`
- Renders the migration report using `create_html_artifact`

**Bob features demonstrated:** Subagent with fork_context, HTML artifact output.

### Bobcoin Optimisation Choices

| Optimisation | Technique |
|---|---|
| Keep analysis out of main context | `explore` subagents; results as compact summaries |
| Avoid re-reading unchanged files | Session JSON persists analysis; no re-analysis on context reset |
| Compact MCP tool outputs | Tools return 200–500 char summaries, not raw file contents |
| Single Plan mode pass | Plan mode used once to produce an approvable artifact, not iteratively |
| Limit check loops | Max 3 iterations hard-coded in session config |
| No speculative file reads | Bob reads a file only after AST analysis confirms it is affected |

---

## 9. Demo Scenario

### Target Repository

**`facebook/create-react-app` kitchen-sink example** — or, more precisely, a
well-known public repository pinned at React 17 that has a mix of class
components, functional hooks, `ReactDOM.render`, `act()` in tests, and
concurrent-mode incompatible patterns. We will fork this repository for the
demo so the PR can be shown in full.

Candidate: **`gothinkster/react-redux-realworld-example-app`** (React 17,
Redux, clear migration surface).

### Demo Script (7 minutes)

| Time | Action | Feature Shown |
|---|---|---|
| 0:00–0:30 | Introduce the problem: "React 17 → 18 upgrade, ~40 files affected" | Setup |
| 0:30–1:30 | User pastes repo URL + React 18 migration guide PDF into Bob | Agent mode, document understanding |
| 1:30–2:30 | Bob runs analysis; two subagent breadcrumbs appear in parallel | Parallel subagents |
| 2:30–3:30 | Bob switches to Plan mode; migration plan Markdown appears in chat | Plan mode |
| 3:30–4:00 | User reviews plan; types "approved" | Approval gate |
| 4:00–5:30 | Agent mode implements changes; todo list ticks off; 3 subagents visible | Agent mode, todo list, subagents |
| 5:30–6:00 | Checks run; one test fails; subagent diagnoses and fixes it | Iterative loop, subagent diagnosis |
| 6:00–7:00 | HTML migration report + PR link appear; productivity stats shown | HTML artifact, PR, measurable productivity |

### Measurable Productivity Metric

The migration report includes:

- **Manual estimate:** N files × estimated 30 min/file = X hours
- **Codebase Doctor time:** wall-clock time from session start to PR
- **Bobcoins consumed:** read from session log
- **Files changed correctly / total affected:** accuracy rate

This directly satisfies the "measurable developer productivity improvement"
hackathon requirement.

---

## 10. Testing Strategy

### MCP Server Unit Tests (Vitest)

Each tool in `backend/src/tools/` has a corresponding unit test that mocks
the `lib/` layer (git, GitHub API, shell). Focus areas:

- `analyze_dependency_usage` — given a fixture repo, returns correct AST hits
- `calculate_migration_blast_radius` — risk scores are deterministic for fixture input; use `severity-guide.md` values as expected bounds
- `verify_migration` — correct parsing of lint/test/build stdout/stderr
- `generate_report` — output matches expected markdown shape

### Integration Test (single end-to-end)

One integration test clones a tiny fixture repository (`test/fixtures/react17-app`)
that deliberately contains 5 React 17 patterns (legacy `ReactDOM.render`,
`act`, etc.) and verifies the full pipeline produces a correct diff.

This test is excluded from CI (tagged `@slow`) but must pass locally before
the demo.

### Manual Demo Rehearsal

Run the full demo scenario twice the day before the hackathon presentation.
Document any Bob prompt adjustments needed in `demo/walkthrough-script.md`.

---

## 11. Deployment Strategy

Codebase Doctor is a **local tool** — no cloud infrastructure is required for
the hackathon.

### Setup for Judges / Reviewers

```bash
git clone https://github.com/FayazNoor/Codebase-Doctor
cd codebase-doctor/backend
npm install && npm run build

# Add to Bob IDE MCP config (one command):
bob mcp add codebase-doctor --command "node ./backend/dist/index.js"

# Set GitHub token:
export GITHUB_TOKEN=<your-pat>
```

### Why Local-Only is the Right Choice for the Hackathon

- No infrastructure cost (protects Bobcoin budget)
- No auth/CORS/HTTPS complexity during the demo
- MCP stdio transport is zero-latency
- Repo cloning is local, so no data leaves the machine (good for sensitive repos)
- The MCP server design is cloud-deployable post-hackathon (add HTTP transport)

### Post-Hackathon Cloud Path

Replace stdio transport with HTTP SSE transport. Deploy the MCP server as a
Fly.io or Railway container. GitHub OAuth replaces PAT. Add a simple Next.js
status dashboard.

---

## 13. Implementation Phases

### Phase 1 — Core MCP Server (Days 1–2)

**Goal:** MCP server registers all tools; `analyze_dependency_usage` and
`calculate_migration_blast_radius` work end-to-end on a local fixture.

- [ ] Scaffold MCP server with TypeScript (`npm create mcp-server`)
- [ ] Implement `lib/git.ts` — clone, branch, commit, push
- [ ] Implement `lib/ast.ts` — import finder for TS/JS using `ts-morph`
- [ ] Implement `analyze_dependency_usage` tool
- [ ] Implement `calculate_migration_blast_radius` tool
- [ ] Write unit tests for AST finder with fixture

### Phase 2 — Migration Knowledge + Docs Ingestion (Day 2)

**Goal:** Bob can read a PDF migration guide and the MCP server maps it to
specific `DependencyUsage` records.

- [ ] Seed `knowledge/react-17-to-18.md` with breaking changes (structured)
- [ ] Author `severity-guide.md` — risk scoring reference table
- [ ] Implement `load_migration_requirements` tool (reads knowledge file + optional URL/text)
- [ ] Wire document input from Bob chat (user attaches PDF; Bob passes text to tool)
- [ ] Write unit test for docs mapping

### Phase 3 — Implementation Tools (Days 3–4)

**Goal:** MCP server can apply changes, generate a plan, and verify.

- [ ] Implement `generate_migration_plan` tool
- [ ] Implement `checkout_branch` tool
- [ ] Implement `apply_migration_patch` tool (targeted file edits via lib/ast.ts transforms)
- [ ] Implement `verify_migration` tool (wraps run_checks; returns structured diagnosis)
- [ ] Implement `run_checks` tool (spawn shell, capture output, parse failures)
- [ ] Implement `generate_report` tool (produces Markdown + HTML)
- [ ] Implement `create_pull_request` tool (Octokit)
- [ ] Integration test: full pipeline on fixture repo

### Phase 4 — Skill + Bob Workflow (Days 4–5)

**Goal:** The `migration-doctor` skill is live and the full workflow from
Section 9 works end-to-end on the real demo target repository.

- [ ] Author `SKILL.md` — procedural steps, MCP tool mapping, mode-switch instructions
- [ ] Author `migration-checklist.md` — canonical step checklist for todo list template
- [ ] Test skill auto-activation with several phrasing variants
- [ ] Write and test the exact Bob prompts for each phase (document in
  `demo/walkthrough-script.md`)
- [ ] Configure `.bob/settings.json` to register the MCP server
- [ ] Write `.bob/rules/AGENTS.md` and `.bob/rules-agent/AGENTS.md`
- [ ] Run Phase 0–5 end-to-end on the fork of the demo repo
- [ ] Measure Bobcoin consumption; adjust subagent strategy if too expensive

### Phase 5 — Polish & Demo Prep (Day 5–6)

**Goal:** Demo is rehearsed, report is impressive, repo README is clear.

- [ ] Style the `create_html_artifact` migration report (metrics, diff table,
  blast radius chart)
- [ ] Write `demo/target-repo.md` explaining the chosen repo and why it is a
  good showcase
- [ ] Rehearse demo twice; time it
- [ ] Write project README with one-command setup
- [ ] Record a 2-minute backup video in case of live demo issues

> **Note:** Section numbers in "Bob Workflow Design" reference phases by name
> (0–5); implementation phases above are development milestones (1–5).
> They are parallel tracks, not the same numbering.

---

## 14. Task Split — Two Developers

### Developer A — MCP Server & Infrastructure

**Owns:** Everything in `backend/`

| Task | Phase |
|---|---|
| Scaffold MCP server, TypeScript config, build pipeline | 1 |
| `lib/git.ts` — all git operations | 1 |
| `lib/ast.ts` — AST import finder + transform helpers | 1 |
| `analyze_dependency_usage`, `calculate_migration_blast_radius` | 1 |
| `load_migration_requirements` + knowledge base seeding | 2 |
| `generate_migration_plan`, `checkout_branch`, `apply_migration_patch` | 3 |
| `verify_migration`, `run_checks` — shell execution + output parsing | 3 |
| `create_pull_request` — Octokit integration | 3 |
| Unit tests for all tools | 1–3 |
| Integration test (fixture repo) | 3 |

### Developer B — Skill, Knowledge & Demo

**Owns:** `migration-doctor` skill, knowledge files, report, demo

| Task | Phase |
|---|---|
| Author `severity-guide.md` — risk scoring reference | 2 |
| `generate_report` tool + HTML artifact template | 3 |
| Author `SKILL.md` — procedural workflow + MCP tool mapping | 4 |
| Author `migration-checklist.md` — canonical todo checklist | 4 |
| Test skill auto-activation phrasing | 4 |
| Bob prompt engineering for all phases (document in walkthrough script) | 4 |
| `.bob/settings.json` MCP registration + `AGENTS.md` files | 4 |
| End-to-end test on demo target repo | 4 |
| Migration report styling (HTML/CSS, productivity metrics) | 5 |
| Demo script, rehearsal, README | 5 |
| Backup demo video | 5 |

### Sync Points

| When | What |
|---|---|
| End of Day 1 | MCP server boots; `analyze_dependency_usage` returns session JSON |
| End of Day 2 | `calculate_migration_blast_radius` works on fixture; `severity-guide.md` drafted |
| End of Day 3 | Full MCP tool set available; Dev B starts skill authoring |
| End of Day 4 | `migration-doctor` skill activates; end-to-end pipeline works on demo repo |
| End of Day 5 | Demo rehearsed; Bobcoin budget measured and adjusted |

---

## 15. Hackathon Risks & Scope Cuts

### Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Demo repo is too large → Bobcoin budget runs out | Medium | High | Pre-select a small (< 50 affected files) repo; set `maxFiles` cap in session config |
| AST transform produces broken code | Medium | High | `apply_migration_patch` always writes to a temp branch; broken code never reaches main |
| GitHub API rate-limit during demo | Low | Medium | Cache clone locally; only PR creation needs API during demo |
| Bob plan mode produces non-approvable plan (too vague) | Medium | Medium | Seed `AGENTS.md` with structured plan output format; pre-test prompts |
| MCP server crashes mid-demo | Low | High | Session state on disk; re-running any tool is safe (idempotent design) |
| PDF migration guide parsing loses structure | Low | Low | Pre-extract PDF to markdown as fallback; keep in `knowledge/` dir |

### Approved Scope Cuts (MVP)

These are explicitly out of scope for the hackathon submission:

| Cut | Reason |
|---|---|
| Multi-language support (Python, Ruby, etc.) | AST layer is TS/JS only for MVP |
| Automatic migration doc discovery (no URL input) | User supplies docs or we use seeded knowledge |
| Monorepo support (multiple package.json) | Single-package repos only for MVP |
| Web UI / dashboard | Bob IDE is the UI; no separate frontend |
| Cloud deployment / multi-user | Local stdio MCP only |
| Rollback / undo | New branch approach is inherently safe; rollback = delete branch |
| Codemod integration (jscodeshift) | Manual AST transforms for MVP; codemods as Phase 2 post-hackathon |

### Minimum Viable Demo (if time runs short)

If Phase 3 (implementation tools) is not complete, the demo can show:

1. Analysis → blast radius report (very impressive standalone)
2. Plan mode migration plan output
3. **Manually apply one change** and show the Bob-assisted verify loop

This still demonstrates: Agent mode, Plan mode, parallel subagents, document
understanding, skill auto-activation, MCP server, and a productivity report.

---

*Plan authored: ready for team review and approval.*  
*Do not begin implementation until this plan is approved.*
