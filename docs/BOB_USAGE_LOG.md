# Bob Usage Log

Running log of development sessions on Codebase Doctor, recorded for the hackathon submission.
Each entry captures what Bob was asked to do, what changed, and the outcome.

---

## Session A+B — Project Scaffold, TypeScript Fixes & AGENTS.md

**Date:** 2026-09-26  
**Mode:** Agent

### Task

Scaffold the full Codebase Doctor repository from scratch: implement all 10 MCP tools, 5 lib helpers,
knowledge base JSON, unit tests, Bob skill, and supporting documentation. Then fix TypeScript errors,
align test score bounds with the scoring algorithm, add AGENTS.md files, and update the repo URL.

### What Bob did

1. **Scaffolded** `backend/`, `.bob/`, `docs/`, `submission/`, `frontend/` placeholder directories
2. **Implemented** all 10 MCP tools under `backend/src/tools/`, 5 lib helpers under `backend/src/lib/`
3. **Seeded** knowledge base JSON for React 17→18 and Express 4→5 in `backend/src/knowledge/`
4. **Wrote** 14 Vitest unit tests; fixed TypeScript errors and aligned risk score bounds with algorithm
5. **Added** `AGENTS.md` (root, `.bob/rules/`, `.bob/rules-agent/`) with strict MCP tool call order
6. **Updated** repo URL to `github.com/FayazNoor/Codebase-Doctor`

### Files changed

| File | Change |
|---|---|
| `backend/src/` (all files) | Full MCP server implementation |
| `backend/test/` | 14 unit tests (risk + AST) |
| `.bob/skills/migration-doctor/` | Custom skill SKILL.md + supporting files |
| `AGENTS.md`, `.bob/rules/AGENTS.md`, `.bob/rules-agent/AGENTS.md` | Agent rules |
| `docs/IMPLEMENTATION_PLAN.md` | Full design plan |

### Outcome

| Metric | Result |
|---|---|
| TypeScript compilation | ✅ Clean |
| Build (`tsc`) | ✅ Clean |
| Tests | **14 / 14 passing** |

---

## Session C — Consistency Audit: mcp-server → backend rename

**Date:** 2026-09-26  
**Mode:** Agent

### Task

Audit the repository for stale path references after the `mcp-server/` → `backend/` rename.
Fix all documentation and config without moving any working code.

### What Bob did

1. **Inspected** full repository structure; confirmed `backend/` as canonical MCP directory
2. **Grepped** all `.md` and `.json` files for stale `mcp-server/` filesystem path references
3. **Fixed** `AGENTS.md` (root) — 2 path references
4. **Fixed** `.bob/rules/AGENTS.md` — 2 path references
5. **Fixed** `package.json` (root) — workspace entry + 3 `--workspace=` script flags
6. **Fixed** `docs/IMPLEMENTATION_PLAN.md` — 5 filesystem path references
7. **Regenerated** `package-lock.json` to clear stale workspace key
8. **Verified** zero remaining `mcp-server/` path references
9. **Ran** `npm run build` (clean) and `npm test` (14/14 passed)
10. **Committed** all changes (`5d17408`)

### Files changed

| File | Change |
|---|---|
| `AGENTS.md` | 2 stale path references → `backend/` |
| `.bob/rules/AGENTS.md` | 2 stale path references → `backend/` |
| `package.json` | Workspace + 3 script flags → `backend` |
| `docs/IMPLEMENTATION_PLAN.md` | 5 filesystem path references → `backend/` |
| `package-lock.json` | Regenerated; stale workspace key removed |

### Outcome

| Metric | Result |
|---|---|
| Stale `mcp-server/` path references | ✅ Zero remaining |
| Build (`tsc`) | ✅ Clean |
| Tests | **14 / 14 passing** |

---

## Session D — React 17→18 Migration Engine Coverage

**Date:** 2026-09-26  
**Mode:** Agent

### Task

Complete automated transform coverage for `react-bc-1` through `react-bc-7` in the React 17→18 migration engine. Verify detection logic, implement missing transforms, mark non-automatable changes explicitly, and add focused unit tests.

### What Bob did

1. **Inspected** `src/knowledge/react-17-to-18.json`, `src/tools/apply-migration-patch.ts`, `src/tools/load-migration-requirements.ts`, `src/tools/generate-migration-plan.ts`, all existing unit tests, and the `react17-app` fixture to establish a full picture of current state.

2. **Produced a coverage matrix** for all 7 breaking changes — identified that bc-1 and bc-2 had broken regex transforms (failed on containers containing function calls like `document.getElementById('root')`), bc-3 had no transform despite being marked `automatable: true`, and bc-6 had a non-detectable `affectedApis` value (`["StrictMode"]` is never an imported symbol).

3. **Created `src/lib/transforms.ts`** — a dedicated, testable transforms module with:
   - `transformReactDOMRender` (bc-1): replaces `ReactDOM.render(el, container)` with `createRoot(container).render(el)`. Uses a balanced-paren arg-splitter instead of regex to correctly handle `document.getElementById('root')` and multi-line JSX. Explicitly skips 3-arg calls (bc-5 territory).
   - `transformReactDOMHydrate` (bc-2): replaces `ReactDOM.hydrate(el, container)` with `hydrateRoot(container, el)` (argument order swap). Same balanced-paren logic.
   - `transformActImport` (bc-3): rewrites `import { act } from 'react-dom/test-utils'` → `import { act } from 'react'`; when `act` is one of multiple named imports, splits the statement correctly.

4. **Updated `apply-migration-patch.ts`** to import from `transforms.ts` instead of containing ad-hoc inline regexes.

5. **Added `manualAction` guidance** to the knowledge base entries for bc-4 through bc-7, wired into `generate-migration-plan.ts` so every manual step description includes actionable human instructions.

6. **Fixed `react-bc-6` detection** — changed `affectedApis` from `["StrictMode"]` (never imported as a symbol) to `[]` (always-applicable), matching the existing filter logic in `load-migration-requirements.ts`.

7. **Added `BreakingChange.manualAction?`** optional field to `src/types.ts`.

8. **Created `test/unit/transforms.test.ts`** — 20 new unit tests covering every automated transform, including idempotency, preservation of unrelated code, single-line, multi-line, mixed-import, and exact fixture-file patterns.

### Files changed

| File | Change |
|---|---|
| `backend/src/lib/transforms.ts` | **New** — dedicated transforms module |
| `backend/src/tools/apply-migration-patch.ts` | Use `REACT_TRANSFORMS` from `transforms.ts` |
| `backend/src/knowledge/react-17-to-18.json` | `manualAction` fields for bc-4–7; bc-6 `affectedApis` fixed |
| `backend/src/types.ts` | `BreakingChange.manualAction?` optional field added |
| `backend/src/tools/generate-migration-plan.ts` | Emit `manualAction` in manual step descriptions |
| `backend/test/unit/transforms.test.ts` | **New** — 20 transform unit tests |

### Breaking changes left manual (and why)

| ID | Reason |
|---|---|
| **react-bc-4** (auto-batching) | Semantic behaviour change — no syntactic pattern to detect or fix. Requires human analysis of test assertions on intermediate render states. |
| **react-bc-5** (3rd callback arg) | Unsafe to auto-transform: the callback logic must move into `useEffect` — application-specific, not mechanical. The bc-1 transform explicitly skips these calls. |
| **react-bc-6** (StrictMode double effects) | No code change needed; only affects development-mode runtime. Requires human audit of effect cleanup. |
| **react-bc-7** (`unstable_batchedUpdates`) | Semantic change; removing the call is usually safe but not always — requires human verification. |

### Outcome

| Metric | Result |
|---|---|
| TypeScript compilation | ✅ Clean |
| Build (`tsc`) | ✅ Clean |
| Tests | **34 / 34 passing** (+20 new, 0 regressions) |

---
