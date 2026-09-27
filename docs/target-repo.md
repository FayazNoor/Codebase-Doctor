# Demo Target Repository

## Recommended: `examples/react17-demo-app` (ready)

[`examples/react17-demo-app`](../examples/react17-demo-app/README.md) is a small React 17 app built for the demo
(added 2026-09-26). It is green on React 17 (4/4 Jest tests, ESLint clean, esbuild build) and contains the
patterns the React 18 guide warns about. It has been migrated end to end by the real MCP server over stdio
(`backend/scripts/e2e-demo.mjs`); the recorded run is in [`evidence/e2e-run/`](evidence/e2e-run/).

| Measured in the recorded run | Value |
|---|---|
| Files using the React family | 11 (16 imports, 19 API usages; 13 source files scanned) |
| Applicable rules (validated against the React 18 guide PDF) | 8 — 3 automated (bc-1, bc-2, bc-3), 5 manual/review |
| Files with breaking-change evidence | 9 — 4 high, 5 low |
| Peer conflict found before install | `@testing-library/react@12.1.5` (peer `react <18`) → upgraded to ^14.3.1 by the dependency step |
| Verification #1 | FAILED — lint (`react/no-deprecated`: `unmountComponentAtNode`) and 1 test (automatic batching) |
| Verification #2 (after the recorded manual steps) | PASSED — dependencies, lint, test, build |

To demo the pull request **live**, push the folder to a GitHub repository you own and set `GITHUB_TOKEN`. The
recorded run opened its PR against a local sandbox (a mocked GitHub API and a bare repository), not github.com.

**Pre-demo checklist**

- [ ] Repository pushed to your GitHub account; `GITHUB_TOKEN` (repo scope) in `.bob/mcp.json`
- [ ] `npm install && npm test && npm run lint && npm run build` pass on its default branch (baseline green)
- [ ] No `codebase-doctor/react-18.3.1-upgrade` branch or open PR left over from a rehearsal
- [ ] `npm run build` done in this repository; Bob shows the `codebase-doctor` MCP server as connected
- [ ] Time the live run and quote only the measured duration

---

## Previously considered: `gothinkster/react-redux-realworld-example-app` (not suitable)

Facts verified on 2026-09-26 (UTC+05:00) from a read-only shallow clone; nothing was pushed or forked.

| Claimed earlier | Actual (verified) |
|---|---|
| Pinned at React 17 (`"react": "^17.0.2"`) | ❌ `"react": "^16.3.0"`, `"react-dom": "^16.3.0"` |
| Contains test files using `act` from `react-dom/test-utils` | ❌ No test files at all |
| Contains `ReactDOM.render` in `src/index.js` | ✅ Yes (`src/index.js`, 2-argument call) |
| ~40 source files | ✅ 38 files under `src/` |
| — | Tooling: `react-scripts` 1.1.1, no lockfile, no `lint` script |
| — | `react-redux@^5.0.7` declares peer `react: ^0.14 \|\| ^15 \|\| ^16` (checked with `npm view`) |

Why it is not used:

1. `react-redux@5` blocks installing React 18 (npm ERESOLVE). Codebase Doctor now detects this before anything
   changes: the plan gets a peer-compatibility step and, when the registry is reachable, suggests the lowest
   compatible release.
2. It is a React **16** app with no tests, so the verification story cannot be shown.
3. The planned fork `FayazNoor/react-redux-realworld-example-app` was never created.
