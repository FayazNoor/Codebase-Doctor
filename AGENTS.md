# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Project
AI-Assisted Dependency Upgrade Doctor. MCP server at `backend/` (TypeScript/Node.js ESM). Bob skill at `.bob/skills/migration-doctor/`.

## Commands (always run from `backend/`)
```bash
npm install          # install deps
npm run build        # tsc → dist/
npm test             # vitest unit + integration tests (see README for the current count)
npm run typecheck    # tsc --noEmit only
npm run lint         # eslint (flat config)
```

## Non-obvious facts
- `"type": "module"` is set — all imports use `.js` extensions even for `.ts` source files.
- MCP tools return plain strings (aim for ≤500 chars; plan/report are longer by design). Never return JSON objects from tool handlers.
- 11 MCP tools. `approve_migration_plan` records the human approval; `checkout_branch`, `apply_migration_patch` and `create_pull_request` refuse to run without it.
- Analysis scans a package family (`lib/ecosystem.ts`): `react` → react + react-dom (+ subpaths). Risk scores come from concrete API usages (`lib/risk.ts`, documented in `.bob/skills/migration-doctor/severity-guide.md`).
- `run_checks` is internal; `verify_migration` is the skill-facing wrapper.
- Knowledge base is JSON arrays at `src/knowledge/*.json`, not Markdown.
- Session state persists at `$CODEBASE_DOCTOR_HOME/sessions/<uuid>/` (default `~/.codebase-doctor`). Tools are restart-safe, but `analyze_dependency_usage` always starts a new session.
- Package installs go through `setCommandRunner()` in `lib/packages.ts` so tests never hit the network.
- `ts-morph` Project must be constructed fresh per `findDependencyUsages` call (no global instance).
- `generate_report` is called twice per session: `format:"markdown"` for PR body, `format:"html"` for Bob artifact.
