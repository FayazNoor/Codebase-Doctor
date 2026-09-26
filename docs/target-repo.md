# Demo Target Repository

> **Status: NOT READY for the live demo.** Facts below were verified on 2026-09-26 (UTC+05:00)
> from a read-only shallow clone; nothing was pushed or forked.

## Source repository

**[`gothinkster/react-redux-realworld-example-app`](https://github.com/gothinkster/react-redux-realworld-example-app)**
(HEAD `ee72eba`, last commit 2021-09-07)

## Fork

`https://github.com/FayazNoor/react-redux-realworld-example-app` — **pending: not created yet.**
`git ls-remote` on that URL fails (GitHub answers as for a missing or private repository). Create the
fork before relying on it anywhere.

## Verified facts about the source repo

| Claimed earlier | Actual (verified) |
|---|---|
| Pinned at React 17 (`"react": "^17.0.2"`) | ❌ `"react": "^16.3.0"`, `"react-dom": "^16.3.0"` |
| Contains test files using `act` from `react-dom/test-utils` | ❌ No test files at all |
| Contains `ReactDOM.render` in `src/index.js` | ✅ Yes (`src/index.js`, 2-argument call) |
| ~40 source files | ✅ 38 files under `src/` |
| — | Tooling: `react-scripts` 1.1.1, no lockfile, no `lint` script |
| — | `react-redux@^5.0.7` declares peer `react: ^0.14 \|\| ^15 \|\| ^16` (checked with `npm view`) |

### Codebase Doctor analysis of the source repo (local run, no GitHub/API calls)

Run with the current backend (`findDependencyUsages` + `buildRequirements` + `calculateBlastRadius`) on
the clone, React `^16.3.0` → `18.3.1`:

| Result | Value |
|---|---|
| Files using the React family | 25 (26 import sites, 13 API usages) |
| Applicable rules | `react-bc-1` (ReactDOM.render), `react-bc-4` (automatic-batching review) |
| Files with breaking-change evidence | 12 — 1 high (`src/index.js`, 70), 11 low (class components, 20) |
| Coverage warning | repo is on 16.x; built-in rules cover 17 → 18 only |
| Planned dependency step | `react` and `react-dom` `^16.3.0` → `^18.3.1` |

## Why it is not demo-ready

1. **The dependency step will fail (by design):** npm ≥ 7 will reject React 18 because `react-redux@5`
   only allows React ≤ 16 (ERESOLVE). `apply_migration_patch` restores package.json and reports the
   conflict instead of silently forcing it.
2. **The narrative does not match:** it is a React **16** app, not 17, and has no tests, so the
   `act()` / test-utils story and "verify loop fixes a failing test" cannot happen on it.
3. **Verification may not be meaningful:** `react-scripts` 1.1.1 (2018) with no test files; whether
   its build runs on Node 20 has not been checked.
4. The fork does not exist yet.

## Options (decision needed — no external repo was changed)

- **A. Prepare the fork** — fork it, then commit a clearly-labelled baseline on the fork's default
  branch *before* the demo: React 17 + `react-redux@7` (supports 16.8–18) + a current `react-scripts`,
  plus a small test using `act` from `react-dom/test-utils`. The demo then shows a genuine 17 → 18
  migration on that baseline.
- **B. Choose a different public repo** that is already on React 17 with tests and a lockfile.

## Pre-demo checklist (after A or B)

- [ ] Fork exists and `GITHUB_TOKEN` has `repo` scope on it
- [ ] `npm install` on the default branch succeeds with Node 20
- [ ] `npm test` / `npm run build` succeed on the default branch (baseline is green)
- [ ] Run `analyze_dependency_usage` once and record the real blast radius here
- [ ] Delete any old migration branch from the fork before the live demo
- [ ] Time the full end-to-end run and record the measured duration (do not use estimates)
