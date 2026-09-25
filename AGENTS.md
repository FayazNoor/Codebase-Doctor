# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Project
AI-Assisted Dependency Upgrade Doctor. MCP server at `backend/` (TypeScript/Node.js ESM). Bob skill at `.bob/skills/migration-doctor/`.

## Commands (always run from `backend/`)
```bash
npm install          # install deps
npm run build        # tsc → dist/
npm test             # vitest unit tests (14 tests, ~300ms)
npm run typecheck    # tsc --noEmit only
```

## Non-obvious facts
- `"type": "module"` is set — all imports use `.js` extensions even for `.ts` source files.
- MCP tools return plain strings (≤500 chars). Never return JSON objects from tool handlers.
- `run_checks` is internal; `verify_migration` is the skill-facing wrapper.
- Knowledge base is JSON arrays at `src/knowledge/*.json`, not Markdown.
- Session state persists at `~/.codebase-doctor/sessions/<uuid>/` — all tools are idempotent.
- `ts-morph` Project must be constructed fresh per `findDependencyUsages` call (no global instance).
- `generate_report` is called twice per session: `format:"markdown"` for PR body, `format:"html"` for Bob artifact.
