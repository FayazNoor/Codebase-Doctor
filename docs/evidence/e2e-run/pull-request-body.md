<!-- Sandbox: body of the PR the tool sent to the mocked GitHub API. Title: chore(deps): upgrade react ^17.0.2 → 18.3.1 [Codebase Doctor] · codebase-doctor/react-18.3.1-upgrade → main · labels: codebase-doctor, dependencies -->

## 🩺 Codebase Doctor — react ^17.0.2 → 18.3.1

> This pull request was created by [Codebase Doctor](https://github.com/FayazNoor/Codebase-Doctor) using IBM Bob. Every plan step was approved by a human first, and the dependency check plus lint/test/build (whichever the repository defines) passed on the pushed commit before it was opened.

### Summary
Upgrade react from ^17.0.2 to 18.3.1 across 9 affected files. 10 migration steps: 4 automatable, 6 requiring manual changes or review.


---
## Migration Report: react ^17.0.2 → 18.3.1

Repository: `codebase-doctor-sandbox/pantry-list` · Branch: `codebase-doctor/react-18.3.1-upgrade` · Plan `b3b654d66018` approved at 2026-09-26T10:19:06.095Z

### Verification (measured)

✅ PASSED (iteration 2, 2026-09-26T10:25:25.438Z, commit 55040d8)

| Check | Result | Command |
|---|---|---|
| Dependencies installed | PASS | react@18.3.1, react-dom@18.3.1 |
| Lint | PASS | npm run lint |
| Test | PASS | npm run test |
| Build | PASS | npm run build |

Verification history: #1 failed on `f8756bf` → #2 passed on `55040d8`

### Measured

| Metric | Value |
|---|---|
| Files using react (package family) | 11 |
| Files with breaking-change evidence | 9 |
| Files changed on migration branch | 9 |
| Steps automatically applied | 4 / 10 |
| Steps manually fixed / reviewed | 6 |
| Steps still requiring manual action | 0 |
| Steps skipped by user | 0 |
| Steps failed | 0 |
| Steps not applicable | 0 |
| Steps not started | 0 |
| Elapsed session time (wall-clock, session start → this report) | 7 min |

### Estimated (not measured)

| Metric | Value | Basis |
|---|---|---|
| Estimated manual effort | ~4.5 h | 9 affected files × 30 min/file (heuristic, not benchmarked) |
| Estimated time saved | ~4.4 h | estimated manual effort − measured elapsed time |

### Not measured

- Bobcoin consumption — not measured (not exposed to the MCP server)
- Accuracy — not measured (no ground-truth benchmark)

### Blast Radius

🟡 Moderate blast radius

| Risk tier | Files |
|---|---|
| 🔴 High (≥70) | 4 |
| 🟡 Medium (40–69) | 0 |
| 🟢 Low (1–39) | 5 |

| Top affected file | Score | Evidence |
|---|---|---|
| `src/legacy/toast.jsx` | 90 | react-bc-1 +40, react-bc-8 +20, root bootstrap +30 |
| `src/legacy/toast.test.jsx` | 90 | react-bc-1 +40, react-bc-3 +20, react-bc-12 +10, test harness +20 |
| `src/index.jsx` | 80 | react-bc-1 +40, react-bc-6 +10, root bootstrap +30 |
| `src/ssr-entry.jsx` | 70 | react-bc-2 +40, root bootstrap +30 |
| `src/App.jsx` | 20 | react-bc-4 +20 |
| `src/components/AddItemForm.jsx` | 20 | react-bc-4 +20 |
| `src/components/ItemList.jsx` | 20 | react-bc-4 +20 |
| `src/components/SyncStatus.jsx` | 20 | react-bc-4 +20 |
| `src/legacy/store.js` | 10 | react-bc-7 +10 |

### Breaking Changes

| Status | Severity | Breaking change | Files |
|---|---|---|---|
| ✅ Automatically fixed | HIGH | `react-bc-1` ReactDOM.render() is deprecated in React 18 (the app keeps running in legacy React 17 mode) — replace with createRoot().render() | 3 |
| ✅ Automatically fixed | HIGH | `react-bc-2` ReactDOM.hydrate() is deprecated in React 18 (legacy mode) — replace with hydrateRoot() | 1 |
| ✅ Automatically fixed | MEDIUM | `react-bc-3` act() from react-dom/test-utils is deprecated — import act from 'react' (available from React 18.3) | 1 |
| ✍️ Manually fixed / reviewed | MEDIUM | `react-bc-4` Automatic batching: setState calls in timeouts/promises/native handlers are now batched — may affect code or tests relying on intermediate renders | 4 |
| ✍️ Manually fixed / reviewed | LOW | `react-bc-6` Strict Mode now double-invokes effects (mount → unmount → mount) in development to surface side effects | 1 |
| ✍️ Manually fixed / reviewed | LOW | `react-bc-7` ReactDOM.unstable_batchedUpdates is redundant under React 18 automatic batching | 1 |
| ✍️ Manually fixed / reviewed | MEDIUM | `react-bc-8` ReactDOM.unmountComponentAtNode() is deprecated in React 18 — call root.unmount() on the root returned by createRoot() | 1 |
| ✍️ Manually fixed / reviewed | LOW | `react-bc-12` Tests that render with react-dom directly need globalThis.IS_REACT_ACT_ENVIRONMENT = true under React 18 | 1 |

### Peer-dependency compatibility

| Package | Peer range | Resolution |
|---|---|---|
| `@​testing-library/react@12.1.5` | react &lt;18.0.0 | upgraded to ^14.3.1 by the dependency step |

### Migration Steps

- [x] Update react, react-dom, @​testing-library/react to 18.3.1 and install (config) — ✅ Automatically fixed · `798ad60`
  - Ran `npm install --no-audit --no-fund`; installed react@​18.3.1, react-dom@​18.3.1.
- [x] ReactDOM.render() is deprecated in React 18 (the app keeps running in legacy React 17 mode) — replace with createRoot().render() (codemod) — ✅ Automatically fixed · `72cea40`
  - Transformed 3 file(s); no remaining usages of the old API.
- [x] ReactDOM.hydrate() is deprecated in React 18 (legacy mode) — replace with hydrateRoot() (codemod) — ✅ Automatically fixed · `148d1eb`
  - Transformed 1 file(s); no remaining usages of the old API.
- [x] act() from react-dom/test-utils is deprecated — import act from 'react' (available from React 18.3) (codemod) — ✅ Automatically fixed · `f8756bf`
  - Transformed 1 file(s); no remaining usages of the old API.
- [x] Automatic batching: setState calls in timeouts/promises/native handlers are now batched — may affect code or tests relying on intermediate renders (manual) — ✍️ Manually fixed / reviewed · `1138182`
  - Completed manually: Audited async setState: only SyncStatus updates state in a promise callback; its test now expects the single batched render
- [x] ReactDOM.unmountComponentAtNode() is deprecated in React 18 — call root.unmount() on the root returned by createRoot() (manual) — ✍️ Manually fixed / reviewed · `d9fc42f`
  - Completed manually: toast.jsx keeps the root returned by createRoot and calls root.unmount() instead of unmountComponentAtNode
- [x] Strict Mode now double-invokes effects (mount → unmount → mount) in development to surface side effects (manual) — ✍️ Manually fixed / reviewed
  - Completed manually: No component uses effects with external side effects; double-invoking is harmless
- [x] ReactDOM.unstable_batchedUpdates is redundant under React 18 automatic batching (manual) — ✍️ Manually fixed / reviewed · `55040d8`
  - Completed manually: Removed unstable_batchedUpdates from store.js; subscribers are notified directly
- [x] Tests that render with react-dom directly need globalThis.IS_REACT_ACT_ENVIRONMENT = true under React 18 (manual) — ✍️ Manually fixed / reviewed · `1472489`
  - Completed manually: Added jest.setup.js setting globalThis.IS_REACT_ACT_ENVIRONMENT = true (jest.setupFiles)
- [x] Update and verify tests (test) — ✍️ Manually fixed / reviewed
  - Completed manually: Test suite updated for React 18 (SyncStatus batching expectation, act environment)

---
Generated by [Codebase Doctor](https://github.com/FayazNoor/Codebase-Doctor) from persisted session data (session `3fd51510-5cd8-41f8-8271-285c542bb72f`).