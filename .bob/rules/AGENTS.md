# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Project

**Codebase Doctor** — AI-Assisted Dependency Upgrade Doctor powered by IBM Bob 2.0.
MCP server in `backend/` (TypeScript/Node.js). Skill in `.bob/skills/migration-doctor/`.

## Commands (run from `backend/`)

```bash
npm install          # install dependencies
npm run build        # tsc compile → dist/
npm test             # vitest unit + integration tests
npm run typecheck    # type-check without emitting
npm run lint         # eslint src/ (flat config: eslint.config.js)
```

## Critical non-obvious patterns

- **Tool outputs must be compact strings** — all MCP tools return a plain-text summary, not JSON objects (aim for ≤500 chars; the plan and report are the deliberate exceptions). Bob keeps these in main context; large returns poison it.
- **Session ID is always a UUID** — every tool after `analyze_dependency_usage` requires `sessionId`. Missing it means calling the wrong tool first.
- **`run_checks` is internal** — the skill-facing tool is `verify_migration`, which wraps `run_checks` and adds structured failure diagnosis. Don't expose `run_checks` directly to users.
- **Knowledge base is JSON, not Markdown** — `src/knowledge/` files are `.json` arrays of `BreakingChange`. The markdown files in the plan docs are documentation only.
- **`ts-morph` Project must not be reused across tool calls** — create a new `Project` per `findDependencyUsages` call (no global state in `lib/ast.ts`).
- **`generate_report` is called twice** — once with `format:"markdown"` by `create_pull_request` for the PR body, and once with `format:"html"` by Bob to render the `create_html_artifact`. Both from the same session data.
- **Approval gate is enforced in the backend** — `checkout_branch`, `apply_migration_patch` and `create_pull_request` call `assertPlanApproved()`; approval is recorded only by `approve_migration_plan` (planId + "approved").
- **Honest step status** — `MigrationStep.status` is `pending | applied | manual_required | completed_manual | not_applicable`. Never set `applied` for a step that made no change.
- **Restart safety (not blanket idempotency)** — `analyze_dependency_usage` always creates a new session. Every other tool is safe to re-call: the plan keeps deterministic step IDs, processed steps are skipped, `checkout_branch` switches to an existing branch, `create_pull_request` returns the existing PR. See docs/ARCHITECTURE.md → "Restart behaviour".
