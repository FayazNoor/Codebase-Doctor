# Pantry list — React 17 demo app

A small but real React 17 app used as the Codebase Doctor end-to-end demo target. It has real Jest tests
(React Testing Library 12), a real ESLint config and a real esbuild build. Baseline on React 17: 4/4 tests pass,
lint is clean, and the build succeeds.

It deliberately contains the patterns the React 18 upgrade guide warns about:

| File | Pattern | Rule |
|---|---|---|
| `src/index.jsx` | `ReactDOM.render(<React.StrictMode>…)` | react-bc-1 (automated), react-bc-6 |
| `src/ssr-entry.jsx` | `ReactDOM.hydrate(...)` | react-bc-2 (automated) |
| `src/legacy/toast.jsx` | a separate root per toast + `unmountComponentAtNode` | react-bc-1, react-bc-8 (manual) |
| `src/legacy/toast.test.jsx` | `act` from `react-dom/test-utils`, `ReactDOM.render` in a test | react-bc-3 (automated), react-bc-12 |
| `src/legacy/store.js` | `unstable_batchedUpdates` | react-bc-7 (manual) |
| `src/components/SyncStatus.test.jsx` | asserts on an intermediate render inside a promise callback | react-bc-4, **breaks under React 18 batching** |
| `package.json` | `@testing-library/react@12` (peer `react <18`) | peer-compat preflight → upgraded to ^14.3.1 |

## Use it

- **Locally, without Bob:** `npm run e2e` at the repository root copies this app into a fresh git repository and
  drives the real MCP server through the whole workflow. Output goes to `.demo-run/`.
- **In Bob:** give the migration-doctor skill the absolute path of a git copy of this folder. To demo the pull
  request live, push the folder to a GitHub repository you own, set `GITHUB_TOKEN`, and ask:
  `Upgrade react from 17 to 18.3.1 in https://github.com/<you>/pantry-list`.

What happens (observed in the recorded run):

1. The dependency step installs React 18.3.1 and upgrades `@testing-library/react` to ^14.3.1.
2. The automated steps rewrite `render`, `hydrate` and the `act` import.
3. The first verification **fails**: ESLint's `react/no-deprecated` flags `unmountComponentAtNode`, and the
   `SyncStatus` test fails because React 18 batches the two state updates.
4. After the manual steps (keep the root and call `root.unmount()`, update the test, set
   `IS_REACT_ACT_ENVIRONMENT`, drop `unstable_batchedUpdates`), verification passes.
