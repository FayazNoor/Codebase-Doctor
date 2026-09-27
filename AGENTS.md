# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Project
AI-Assisted Dependency Upgrade Doctor. MCP server at `backend/` (TypeScript/Node.js ESM). Bob skill at `.bob/skills/migration-doctor/`.

## Commands (always run from `backend/`, or the same scripts from the repo root)
```bash
npm install          # install deps (run at the repo root — npm workspaces)
npm run build        # tsc → dist/
npm test             # vitest unit + integration tests (see README for the current count)
npm run typecheck    # tsc --noEmit only
npm run lint         # eslint (flat config)
node scripts/e2e-demo.mjs --out ../.demo-run --sandbox-pr   # real stdio run against examples/react17-demo-app
```

## Non-obvious facts
- `"type": "module"` is set — all imports use `.js` extensions even for `.ts` source files.
- MCP tools return plain strings (aim for ≤500 chars; plan/report are longer by design). Never return JSON objects from tool handlers. Throw an `Error` with a next step for failures — the SDK turns it into an MCP tool error.
- 12 MCP tools, registered in `src/server.ts` (`src/index.ts` only starts stdio). `approve_migration_plan` records the human approval; `checkout_branch`, `apply_migration_patch` and `create_pull_request` refuse to run without it, and the plan ID is re-derived from the steps on every check.
- Session files are HMAC-sealed (`lib/integrity.ts`) and written atomically by `lib/session.ts`. Never write session JSON directly — tests included (use `writePlan` etc.).
- Step statuses: `pending | applied | manual_required | completed_manual | skipped | failed | not_applicable`. `failed` steps were rolled back and can be retried; `skipped` needs a note and stays open work.
- Analysis scans a package family (`lib/ecosystem.ts`): `react` → react + react-dom (+ subpaths). Risk scores come from concrete API usages (`lib/risk.ts`, documented in `.bob/skills/migration-doctor/severity-guide.md` — reference scores are asserted exactly in tests).
- `run_checks` is internal; `verify_migration` is the skill-facing wrapper (and the only writer of checks-result/history).
- Knowledge base is JSON arrays at `src/knowledge/*.json`, not Markdown.
- Session state persists at `$CODEBASE_DOCTOR_HOME/sessions/<uuid>/` (default `~/.codebase-doctor`). Tools are restart-safe, but `analyze_dependency_usage` always starts a new session; `get_session_status` recovers the next action.
- External effects are injectable so tests never hit the network: package installs via `setCommandRunner()` (`lib/packages.ts`), npm registry via `setRegistryFetcher()` (`lib/compat.ts`, and `CODEBASE_DOCTOR_OFFLINE=1` in `test/setup.ts`), GitHub via `vi.mock` or `GITHUB_API_URL`.
- `ts-morph` Project must be constructed fresh per `findDependencyUsages` call (no global instance).
- `generate_report` works at any stage; it is called with `format:"markdown"` (PR body, `forPullRequest`) and `format:"html"` (Bob artifact).
- Command output shown to users goes through `lib/output.ts` (`cleanOutput`) — no ANSI codes, no absolute clone paths.
