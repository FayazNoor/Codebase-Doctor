# IBM Bob 2.0 Usage

This document maps every IBM Bob 2.0 feature used in Codebase Doctor to the exact
workflow step where it appears. This is the evidence brief for the hackathon submission.

---

## Feature Map

| Bob 2.0 Feature | Where used in Codebase Doctor | Why it matters |
|---|---|---|
| **Agent mode** | Kickoff, implementation, verify loop, PR creation | Drives all code changes and tool calls end-to-end |
| **Plan mode** | Migration plan generation + approval gate | Produces a structured, user-reviewable plan before any code is touched |
| **Parallel subagents** | Analysis phase — repo AST + docs ingested concurrently | Cuts analysis time in half; keeps main context lean |
| **Background subagents** | Per-file-cluster reads during implementation | Prevents context poisoning from large file reads |
| **Document understanding** | User attaches migration guide PDF | Bob reads and understands PDF migration docs natively — no manual extraction |
| **Custom skill** | `migration-doctor` auto-activates on upgrade intent | Single activation trigger drives the entire 7-step workflow |
| **MCP server** | All backend logic (10 tools) | Exposes reusable repo-analysis tools; works as a standalone MCP for other agents |
| **HTML artifact** | Before/after migration report | Shareable one-pager with productivity metrics |
| **Todo list** | Live progress during implementation | User can see each migration step tick off in real time |
| **Mode switching** | Agent → Plan → Agent | Bob switches modes mid-workflow as the task transitions from analysis to planning to implementation |
| **fork_context subagent** | Final code review subagent | Subagent receives full session history to do an informed diff review |

---

## Workflow Phases and Bob Features

### Phase 0 — Kickoff (Agent mode)

```
User (Agent mode):
  "Upgrade react from 17 to 18 in https://github.com/FayazNoor/react-redux-realworld-example-app
   Here are the React 18 migration docs: [attached PDF]"
```

- **Skill auto-activation**: `migration-doctor` skill detects upgrade intent and activates
- **Document understanding**: attached PDF is read natively; text passed to `load_migration_requirements`
- **MCP tool call**: `analyze_dependency_usage` clones the repo and runs AST analysis

---

### Phase 1 — Analysis (Parallel subagents)

Two `explore` subagents spawn simultaneously:

```
Subagent A: Call analyze_dependency_usage → return top 10 highest-risk files
Subagent B: Call load_migration_requirements → return applicable breaking changes
```

- **Parallel subagents**: both run concurrently; main context only sees compact summaries
- **Context efficiency**: file contents never enter main context — only summaries do

---

### Phase 2 — Blast Radius + Plan (Plan mode)

Bob calls `calculate_migration_blast_radius`, then **switches to Plan mode**:

- **Plan mode**: generates a structured `MigrationPlan` with ordered steps
- **Skill-driven validation**: skill reads `migration-checklist.md` to verify plan completeness
- **Approval gate**: plan is presented to user; implementation does not start until "approved"
- **Mode switching**: `switch_mode` tool transitions Agent → Plan

---

### Phase 3 — Implementation (Agent mode + subagents)

- **Mode switching**: Plan → Agent after user approves
- **Todo list**: `migration-checklist.md` becomes a live todo list; items tick off as steps apply
- **Targeted subagents**: high-risk files (score ≥ 70) get a dedicated `explore` subagent before patching; up to 3 in parallel
- **MCP tools**: `checkout_branch` + `apply_migration_patch` × N

---

### Phase 4 — Verify Loop (Agent mode)

```
loop (max 3 iterations):
  verify_migration → structured pass/fail + diagnosis
  if failed: spawn general subagent with fork_context:true to propose fix
  apply fix → repeat
```

- **Iterative agentic loop**: Bob retries with AI-diagnosed fixes automatically
- **fork_context subagent**: diagnosis subagent has full session history for context

---

### Phase 5 — Report + PR (Agent mode)

- **fork_context subagent**: code review subagent reviews the full diff
- **HTML artifact**: `generate_report` → `create_html_artifact` renders the migration report
- **MCP tool**: `create_pull_request` opens the PR with the full report as body

---

## Custom Skill: `migration-doctor`

**Location:** `.bob/skills/migration-doctor/SKILL.md`

**Activation trigger:**
> "Use when the user wants to upgrade, migrate, bump, or update a dependency or package to a new version"

**Supporting files loaded on demand (not upfront — saves Bobcoins):**
- `migration-checklist.md` — loaded in Phase 2 for plan validation and Phase 3 for todo list
- `severity-guide.md` — loaded by subagents in Phase 1 for risk scoring

**Bobcoin optimisations built into the skill:**
- `explore` subagents for all repo reads (lighter model, isolated context)
- MCP tools return ≤500 char summaries (not raw file dumps)
- Session state on disk — context resets don't lose progress
- Supporting files read only when needed, never upfront

---

## MCP Server

**Location:** `backend/` (local stdio transport)

**10 tools registered:**

| Tool | Phase |
|---|---|
| `analyze_dependency_usage` | 0 — clone + AST analysis |
| `load_migration_requirements` | 0/1 — docs parsing + breaking change mapping |
| `calculate_migration_blast_radius` | 2 — risk scoring |
| `generate_migration_plan` | 2 — plan generation |
| `verify_migration` | 4 — lint/test/build + diagnosis |
| `checkout_branch` | 3 — git branch |
| `apply_migration_patch` | 3 — code changes + commit |
| `run_checks` | internal — raw check runner |
| `create_pull_request` | 5 — GitHub PR |
| `generate_report` | 5 — before/after report |

The MCP server is designed to be **reusable as a standalone tool** — any Bob user can
connect it and call the analysis tools independently of the full migration workflow.
