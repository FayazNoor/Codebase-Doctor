# Bob Usage Log — Fayaz

A chronological record of every IBM Bob 2.0 session used to build Codebase Doctor.  
Update this file **immediately after each session** with the relevant screenshot filename.
Only reference screenshots that exist in this folder.

Dates are taken from the git commit timestamps of each session's work (author timezone UTC+05:00).

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

### 2026-09-26 — Project Scaffold, TypeScript Fixes & AGENTS.md (Sessions A & B)
- **Mode:** Agent
- **Screenshot:** `01-core-architecture-and-mcp-scaffold.png`
- **Bob features used:** Agent mode, write_file, execute_command, apply_diff
- **What Bob did:**
  - Scaffolded full repository: `backend/`, `.bob/`, `docs/`, `submission/`, `frontend/` placeholder
  - Implemented all 10 MCP tools, 5 lib helpers, knowledge base JSON for React 17→18 and Express 4→5
  - Wrote 14 unit tests (Vitest); fixed TypeScript errors and aligned test score bounds with scoring algorithm
  - Added `AGENTS.md` (root + `.bob/rules/` + `.bob/rules-agent/`) with MCP tool call order rules
  - Updated repo URL to `github.com/FayazNoor/Codebase-Doctor`
- **Output / result:** Fully compilable MCP server; 14/14 unit tests passing; clean `tsc` build

---

### 2026-09-26 — Consistency Audit: mcp-server → backend rename (Session C)
- **Mode:** Agent
- **Screenshot:** `02-repository-consistency-audit.png`
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
- **Output / result:** Repository fully consistent; canonical directory `backend/`; build and tests green
- **Note:** the follow-up commit `e2f39a1` says "(2025-07-14)" in its message; that date was wrong and
  was corrected to 2026-09-26 in `be3f7f5`.

---

### 2026-09-26 — React 18 Migration Engine Coverage (Session D)
- **Mode:** Agent
- **Screenshot:** `03-react18-migration-engine-complete.png`
- **Bob features used:** Agent mode, apply_diff (multi-block), write_file, execute_command, update_todo_list
- **What Bob did:**
  - Inspected knowledge base, tools, and fixture to produce a full coverage matrix for bc-1 through bc-7
  - Created `backend/src/lib/transforms.ts` — dedicated transforms module with balanced-paren arg-splitter
  - Implemented `transformReactDOMRender` (bc-1), `transformReactDOMHydrate` (bc-2), `transformActImport` (bc-3)
  - Updated `apply-migration-patch.ts` to use `transforms.ts` instead of ad-hoc inline regexes
  - Added `manualAction` guidance to knowledge base entries for bc-4 through bc-7
  - Fixed `react-bc-6` detection (`affectedApis: ["StrictMode"]` → `[]`)
  - Added `BreakingChange.manualAction?` optional field to `src/types.ts`
  - Wired `manualAction` into `generate-migration-plan.ts` step descriptions
  - Created `test/unit/transforms.test.ts` — 20 new unit tests
- **Output / result:** 34/34 tests passing (+20 new, 0 regressions); clean `tsc` build

---

### 2026-09-26 — Integration Testing & Migration Verification (Session F)
- **Mode:** Agent
- **Screenshot:** `04-end-to-end-integration-test.png`
- **Bob features used:** Agent mode, read_file, apply_diff, write_file, insert_content, execute_command, update_todo_list
- **What Bob did:**
  - Inspected all 8 pipeline tool implementations, fixture files, knowledge base, and existing tests before writing any code
  - Extended fixture with `hydrate.jsx` (react-bc-2) and `BatchedUpdatesExample.jsx` (react-bc-7) patterns
  - Found and fixed two production bugs in `transforms.ts` caught during test development:
    - `transformReactDOMRender` clobbered the `react-dom` import on hydrate-only files (no `.render` call)
    - `transformReactDOMHydrate` idempotency guard triggered on comment text containing `hydrateRoot`
  - Created `backend/test/integration/e2e-react-migration.test.ts` (27 tests) covering all 8 pipeline steps end-to-end against a disposable `os.tmpdir()` git repo; no GitHub, no network
  - Test asserts actual file content (not just exit codes), verifies manual steps stay unapplied, covers failure behavior and `stepId` error handling, cleans up in `afterAll`
  - Updated `vitest.config.ts` to include integration tests with 60-second timeout
- **Output / result:** 61/61 tests passing (+27 integration, 0 regressions); clean `tsc` build; 2 production bugs found and fixed

---

<!-- Add new sessions below this line -->

