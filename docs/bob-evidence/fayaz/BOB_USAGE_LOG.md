# Bob Usage Log — Fayaz

A chronological record of every IBM Bob 2.0 session used to build Codebase Doctor.  
Update this file **immediately after each session** with the relevant screenshot filename.

---

## Log Format

```
### YYYY-MM-DD — Session title
- **Mode:** Agent / Plan / Ask
- **Screenshot:** NN-filename.png
- **Bob features used:** (comma-separated list)
- **What Bob did:**
  - bullet 1
  - bullet 2
- **Output / result:** brief description
```

---

## Sessions

### 2025-01-01 — Project Planning & Architecture
- **Mode:** Plan
- **Screenshot:** 01-project-planning.png
- **Bob features used:** Plan mode, Todo list
- **What Bob did:**
  - Generated project architecture breakdown (frontend / backend / docs layout)
  - Produced ordered implementation task list
  - Identified MCP tool interface design
- **Output / result:** `docs/IMPLEMENTATION_PLAN.md` created; directory structure agreed

---

### 2025-01-02 — Backend MCP Server Implementation
- **Mode:** Agent
- **Screenshot:** 02-backend-implementation.png
- **Bob features used:** Agent mode, Custom skill (build-mcp-server), Todo list, apply_diff
- **What Bob did:**
  - Scaffolded `backend/src/index.ts` with all 10 tool registrations
  - Implemented `backend/src/lib/session.ts`, `risk.ts`, `ast.ts`, `git.ts`, `github.ts`
  - Implemented all 10 tool handlers under `backend/src/tools/`
  - Seeded knowledge base JSON for React 17→18 and Express 4→5
- **Output / result:** Fully compilable MCP server; 14 unit tests passing

---

### 2025-01-03 — Repository Analysis & Testing
- **Mode:** Agent
- **Screenshot:** 03-repository-analysis.png
- **Bob features used:** Agent mode, Parallel subagents, MCP tool call (`analyze_dependency_usage`)
- **What Bob did:**
  - Ran live `analyze_dependency_usage` on the demo target repo
  - Compared AST output against expected fixture data
  - Diagnosed and fixed an import resolution edge case in `ast.ts`
- **Output / result:** All unit tests green; `risk.test.ts` and `ast.test.ts` passing

---

<!-- Add new sessions below this line -->

### 2025-07-14 — Consistency Audit: mcp-server → backend rename
- **Mode:** Agent
- **Bob features used:** Agent mode, grep, apply_diff (multi-block), execute_command, update_todo_list
- **What Bob did:**
  - Inspected full repository structure to confirm `backend/` as canonical MCP directory
  - Grepped all `.md` and `.json` files for stale `mcp-server/` filesystem path references
  - Fixed `AGENTS.md` (root) — 2 path references updated
  - Fixed `.bob/rules/AGENTS.md` — 2 path references updated
  - Fixed `package.json` (root) — workspace entry + 3 `--workspace=` script flags updated
  - Fixed `docs/IMPLEMENTATION_PLAN.md` — 5 filesystem path references updated
  - Regenerated `package-lock.json` to remove stale workspace key
  - Verified zero remaining `mcp-server/` path references after edits
  - Ran `npm run build` (clean) and `npm test` (14/14 passed)
  - Committed all changes in one atomic commit (`5d17408`)
- **Output / result:** Repository fully consistent; canonical directory is `backend/`; build and tests green
