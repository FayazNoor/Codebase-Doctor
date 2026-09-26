# IBM Bob 2.0 — Usage Statement

## How We Used IBM Bob 2.0

IBM Bob 2.0 is not a peripheral tool in Codebase Doctor — it **is** the product. Bob is the user-facing interface, the workflow engine, and the decision maker. Here is a precise account of every Bob feature leveraged and why it was essential.

---

## Feature-by-Feature Account

### 1. Custom Skill (`migration-doctor`)
**File:** `.bob/skills/migration-doctor/SKILL.md`

The `migration-doctor` skill auto-activates whenever a user expresses upgrade intent ("upgrade", "migrate", "bump"). It encodes the entire 7-phase workflow as a procedural instruction set for Bob. Without the skill, a user would have to manually orchestrate every tool call — with it, one natural-language sentence starts the pipeline, which then pauses for the user's approval of the plan.

### 2. Agent Mode
Used for: project setup, MCP server implementation, live tool calls during the migration run, verify loop, PR creation.

Bob's Agent mode drives all code changes. Every file in `backend/src/` was written or revised through Bob Agent mode sessions — tracked in `docs/bob-evidence/fayaz/BOB_USAGE_LOG.md`.

### 3. Plan Mode
Used for: migration plan generation + user approval gate.

Bob switches to Plan mode after calculating blast radius, generating a structured `MigrationPlan` with ordered steps and risk annotations. The plan is presented to the user before any code is touched. This is the human-in-the-loop checkpoint — and it is enforced by the backend: after the user types "approved", Bob calls `approve_migration_plan`, and the tools that change code or push refuse to run until that approval is recorded.

### 4. Parallel Subagents
Used for: Phase 1 analysis — repository analysis and extraction of the attached migration docs run at the same time; up to 3 high-risk file reads in parallel during implementation.

This parallelizes independent analysis tasks and reduces elapsed time when both tasks are substantial (we have not benchmarked parallel vs. sequential). It also keeps the main context lean — file contents never enter main context, only compact summaries.

### 5. Background Subagents with `fork_context`
Used for: high-risk file pre-reads during implementation; final code review.

Files with risk score ≥ 70 get a dedicated `explore` subagent before patching. The final code review subagent uses `fork_context: true` to receive the full session history and produce an informed diff review.

### 6. Document Understanding
Used for: ingesting user-supplied React 18 migration guide PDF.

The user attaches the migration PDF directly in the Bob chat. Bob reads it natively — no manual text extraction, no copy-paste. The extracted content is passed to `load_migration_requirements`, which uses it to confirm the built-in rules (keeping their IDs, so automated fixes still apply) and to add any extra requirement it finds as a manual item.

### 7. MCP Server (11 tools)
**Directory:** `backend/`

All backend logic is exposed as an MCP server. The 11 tools cover the complete migration lifecycle from clone to PR. The server is designed to be reusable independently of the skill — any Bob user can connect it and call individual analysis tools.

### 8. HTML Artifact
Used for: generating the before/after migration report as a shareable one-pager.

`generate_report` produces the report; Bob renders it via `create_html_artifact`. It shows measured results (lint/test/build, files changed, which breaking changes were fixed automatically, manually, or are still open, elapsed time), clearly labelled estimates (manual effort, time saved), and states what is not measured (Bobcoin usage, accuracy).

### 9. Todo List
Used for: live migration progress tracking during implementation.

The migration checklist becomes a `update_todo_list` call sequence. Each step ticks off as `apply_migration_patch` completes it — manual items tick off only once the change is actually made and recorded.

### 10. Mode Switching
Used for: Agent → Plan → Agent transitions mid-workflow.

The skill issues `switch_mode` at the plan generation checkpoint (Plan mode) and again after user approval (Agent mode). This is the cleanest way to enforce the approval gate without blocking the agentic loop.

---

## Bob Feature Evidence

Bob session screenshots are in `docs/bob-evidence/`. Only files that actually exist are listed
(checked 2026-09-26):

```
docs/bob-evidence/
├── fayaz/
│   ├── BOB_USAGE_LOG.md                           ← session record
│   ├── 01-core-architecture-and-mcp-scaffold.png  ← Sessions A/B — scaffold (14 tests)
│   ├── 02-repository-consistency-audit.png        ← Session C — mcp-server → backend audit
│   ├── 03-react18-migration-engine-complete.png   ← Session D — React 18 transforms
│   └── 04-end-to-end-integration-test.png         ← Session F — integration tests (61 tests)
└── teammate/
    ├── BOB_USAGE_LOG.md                           ← no teammate sessions logged yet
    └── README.md
```

---

## Summary

> Codebase Doctor demonstrates IBM Bob 2.0 as a full product platform, not just a coding assistant. Every layer of the system — planning, analysis, implementation, verification, and reporting — runs inside Bob, driven by a custom skill and supported by a custom MCP server. The development sessions are recorded in the Bob usage logs with real screenshots; the end-to-end demo run is still to be recorded.
