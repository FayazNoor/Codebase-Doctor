# IBM Bob 2.0 — Usage Statement

## How We Used IBM Bob 2.0

IBM Bob 2.0 is not a peripheral tool in Codebase Doctor — it **is** the product. Bob is the user-facing interface, the workflow engine, and the decision maker. Here is a precise account of every Bob feature leveraged and why it was essential.

---

## Feature-by-Feature Account

### 1. Custom Skill (`migration-doctor`)
**File:** `.bob/skills/migration-doctor/SKILL.md`

The `migration-doctor` skill auto-activates whenever a user expresses upgrade intent ("upgrade", "migrate", "bump"). It encodes the entire 7-phase workflow as a procedural instruction set for Bob. Without the skill, a user would have to manually orchestrate every tool call — with it, one natural-language sentence triggers the full pipeline.

### 2. Agent Mode
Used for: project setup, MCP server implementation, live tool calls during the migration run, verify loop, PR creation.

Bob's Agent mode drives all code changes. Every file in `backend/src/` was written or revised through Bob Agent mode sessions — tracked in `docs/bob-evidence/fayaz/BOB_USAGE_LOG.md`.

### 3. Plan Mode
Used for: migration plan generation + user approval gate.

Bob switches to Plan mode after calculating blast radius, generating a structured `MigrationPlan` with ordered steps and risk annotations. The plan is presented to the user before any code is touched. This is the human-in-the-loop checkpoint.

### 4. Parallel Subagents
Used for: Phase 1 analysis — AST scan and migration docs parsing run simultaneously.

Two `explore` subagents spawn concurrently. This halves the analysis wall-clock time and keeps the main context lean — file contents never enter main context, only compact summaries.

### 5. Background Subagents with `fork_context`
Used for: high-risk file pre-reads during implementation; final code review.

Files with risk score ≥ 70 get a dedicated `explore` subagent before patching. The final code review subagent uses `fork_context: true` to receive the full session history and produce an informed diff review.

### 6. Document Understanding
Used for: ingesting user-supplied React 18 migration guide PDF.

The user attaches the migration PDF directly in the Bob chat. Bob reads it natively — no manual text extraction, no copy-paste. The extracted content is passed to `load_migration_requirements`.

### 7. MCP Server (10 tools)
**Directory:** `backend/`

All backend logic is exposed as an MCP server. The 10 tools cover the complete migration lifecycle from clone to PR. The server is designed to be reusable independently of the skill — any Bob user can connect it and call individual analysis tools.

### 8. HTML Artifact
Used for: generating the before/after migration report as a shareable one-pager.

`generate_report` produces the report data; Bob renders it via `create_html_artifact` with productivity metrics (time saved, files changed, accuracy score).

### 9. Todo List
Used for: live migration progress tracking during implementation.

The migration checklist becomes a `update_todo_list` call sequence. Each step ticks off in real time as `apply_migration_patch` completes it — the user sees progress without reading logs.

### 10. Mode Switching
Used for: Agent → Plan → Agent transitions mid-workflow.

The skill issues `switch_mode` at the plan generation checkpoint (Plan mode) and again after user approval (Agent mode). This is the cleanest way to enforce the approval gate without blocking the agentic loop.

---

## Bob Feature Evidence

All Bob session screenshots are in `docs/bob-evidence/`:

```
docs/bob-evidence/
├── fayaz/
│   ├── BOB_USAGE_LOG.md          ← timestamped session record
│   ├── 01-project-planning.png
│   ├── 02-backend-implementation.png
│   └── 03-repository-analysis.png
└── teammate/
    ├── BOB_USAGE_LOG.md
    ├── 01-ui-planning.png
    └── 02-frontend-implementation.png
```

---

## Summary

> Codebase Doctor demonstrates IBM Bob 2.0 as a full product platform, not just a coding assistant. Every layer of the system — planning, analysis, implementation, verification, and reporting — runs inside Bob, driven by a custom skill, supported by a custom MCP server, and evidenced by a complete screenshot trail.
