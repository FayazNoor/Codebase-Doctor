# Migration Doctor — Severity Guide

This guide defines how risk scores (0–100) are assigned to files during
blast-radius analysis. It is the canonical reference used by:
- The `calculate_migration_blast_radius` MCP tool (scoring algorithm in `backend/src/lib/risk.ts`)
- `explore` subagents in Step 1 when summarising the top high-risk files
- Unit tests (`backend/test/unit/risk.test.ts`) — the reference scores below are
  asserted **exactly**, so this document, the code and the tests cannot drift apart.

---

## Evidence, not imports

Scores come only from **concrete API usages** found by AST analysis
(`backend/src/lib/ast.ts`): a real `ReactDOM.render(...)` call, a
`<React.StrictMode>` tag, a named `act` import from `react-dom/test-utils`, etc.
Importing a namespace such as `ReactDOM` is **not** evidence that a breaking API
is used. Each breaking change in the knowledge base declares the exact
`module` + `api` patterns that count as evidence (`detect` in
`backend/src/knowledge/*.json`).

For React, analysis covers the whole package family: `react`, `react-dom`,
`react-dom/client`, `react-dom/test-utils`.

---

## Risk Tiers

| Tier | Score range | Meaning | Action |
|------|-------------|---------|--------|
| **High** | 70–100 | Breaking change in a file the whole app or test harness depends on | Spawn a dedicated `explore` subagent before applying patch |
| **Medium** | 40–69 | Breaking change present; changes are usually mechanical | Apply directly with careful review |
| **Low** | 1–39 | Only low/medium-severity evidence (often review items) | Apply directly / review |
| **None** | 0 | Uses the dependency, but only stable APIs | Skip |

---

## Scoring Factors

`score = Σ severity points + context modifiers`, capped to 0–100.

### Breaking-change evidence (per distinct breaking change found in the file)

| Severity of the breaking change | Points |
|---|---|
| high | +40 |
| medium | +20 |
| low | +10 |

A breaking change counts once per file no matter how many call sites it has.

### Context modifiers (only when the file has ≥ 1 breaking-change hit)

| Condition | Points |
|---|---|
| **Root bootstrap** — a non-test file calls an API that creates/renders the app root (React: `render`/`hydrate` from `react-dom`, `createRoot`/`hydrateRoot` from `react-dom/client`) | +30 |
| **Test harness** — the file is a test (`*.test.*`, `*.spec.*`, `__tests__/`) | +20 |

Files with no breaking-change evidence always score 0, whatever their name.

### Severities in the React 17 → 18 knowledge base

| ID | Evidence pattern | Severity | Kind |
|---|---|---|---|
| react-bc-1 | `render` from `react-dom` | high | automated |
| react-bc-2 | `hydrate` from `react-dom` | high | automated |
| react-bc-3 | `act` from `react-dom/test-utils` | medium | automated (needs react ≥ 18.3) |
| react-bc-4 | `useState`, `useReducer`, `Component`, `PureComponent` from `react` | medium | manual review |
| react-bc-5 | `render` from `react-dom` with ≥ 3 arguments | medium | manual |
| react-bc-6 | `StrictMode` from `react` | low | manual review |
| react-bc-7 | `unstable_batchedUpdates` from `react-dom` | low | manual |

---

## Reference Scores (React 17 → 18)

Computed by `lib/risk.ts` and asserted exactly in `risk.test.ts`. Files marked
*fixture* are in `backend/test/fixtures/react17-app/`.

| Pattern | Calculation | Score | Tier |
|---|---|---|---|
| Entry with `ReactDOM.render(<React.StrictMode>…)` (*fixture* `src/index.jsx`) | bc-1 40 + bc-6 10 + root bootstrap 30 | **80** | High |
| Test with `act` from `react-dom/test-utils` + `ReactDOM.render` (*fixture* `src/App.test.jsx`) | bc-1 40 + bc-3 20 + test harness 20 | **80** | High |
| `ReactDOM.hydrate(<App />, el)` (*fixture* `src/hydrate.jsx`) | bc-2 40 + root bootstrap 30 | **70** | High |
| `ReactDOM.render` with a callback (3rd argument) | bc-1 40 + bc-5 20 + root bootstrap 30 | **90** | High |
| Test that only imports/calls `act` from `react-dom/test-utils` | bc-3 20 + test harness 20 | **40** | Medium |
| `unstable_batchedUpdates` + `useState` (*fixture* `src/BatchedUpdatesExample.jsx`) | bc-4 20 + bc-7 10 | **30** | Low |
| Component using only `useState` / `useEffect` (*fixture* `src/StableComponent.tsx`) | bc-4 20 (automatic-batching review) | **20** | Low |
| `import ReactDOM from 'react-dom'` with no changed API used | — | **0** | None |
| `React` imported only for JSX | — | **0** | None |

---

## Blast Radius Thresholds

The `calculate_migration_blast_radius` tool uses these thresholds to produce
the summary line shown to users:

| Affected files (high-risk) | Displayed label |
|---|---|
| 0 | ✅ Minimal blast radius |
| 1–5 | 🟡 Moderate blast radius |
| 6–20 | 🟠 Significant blast radius — review plan carefully |
| 21+ | 🔴 Large blast radius — consider splitting into multiple PRs |
