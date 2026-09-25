# Migration Doctor — Severity Guide

This guide defines how to assign risk scores (0–100) to files and changes
during blast-radius analysis. It is the canonical reference used by:
- The `calculate_migration_blast_radius` MCP tool (scoring algorithm in `lib/risk.ts`)
- `explore` subagents in Step 1 when summarising the top high-risk files
- Unit tests for the blast-radius tool (expected score bounds come from this table)

---

## Risk Tiers

| Tier | Score range | Meaning | Action |
|------|-------------|---------|--------|
| **High** | 70–100 | Almost certain to require non-trivial manual changes | Spawn a dedicated `explore` subagent before applying patch |
| **Medium** | 40–69 | Likely affected; changes may be mechanical | Apply directly with careful review |
| **Low** | 1–39 | Possibly affected; changes are trivial or auto-fixable | Apply directly |
| **None** | 0 | File imports the dependency but uses only stable APIs | Skip |

---

## Scoring Factors

Each factor adds points to the base score of 0. Scores are capped at 100.

### Import Depth & Volume

| Condition | Points |
|---|---|
| File imports ≥ 5 distinct symbols from the dependency | +20 |
| File imports ≥ 2 symbols that appear in the breaking-changes list | +30 |
| File is an entry point (`index.ts`, `main.ts`, `App.tsx`) | +15 |
| File re-exports dependency symbols to other modules | +25 |

### Usage Pattern

| Condition | Points |
|---|---|
| Uses a removed API (confirmed breaking) | +40 |
| Uses a deprecated API (warning in old version, error in new) | +25 |
| Uses an API whose signature changed | +20 |
| Uses an API that changed async/sync behaviour | +30 |
| Uses an API that changed default options | +10 |

### Test File Modifiers

| Condition | Points |
|---|---|
| File is a test file AND uses testing utilities that changed | +20 |
| File is a test file AND only uses stable testing utilities | −10 (minimum 0) |

### Config & Bootstrap Modifiers

| Condition | Points |
|---|---|
| File is the app bootstrap / entry (contains `render`, `mount`, `createApp`) | +20 |
| File is a framework config (vite/webpack/jest config) | +15 |

---

## Well-Known React 17 → 18 Score Examples

These are reference scores for the demo migration. The scoring algorithm in
`lib/risk.ts` must reproduce these within ±5 points on the fixture repo.

| Pattern | Expected score |
|---|---|
| File containing `ReactDOM.render(...)` | 85 |
| File containing `import { act } from 'react-dom/test-utils'` in a test | 55 |
| File using only `useState`, `useEffect` hooks | 15 |
| File using `ReactDOM.hydrate(...)` | 90 |
| File importing `React` but only for JSX transform (no API calls) | 5 |
| `App.tsx` entry using `ReactDOM.render` + `React.StrictMode` | 95 |

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
