# Demo Target Repository

## Chosen repository

**[`gothinkster/react-redux-realworld-example-app`](https://github.com/gothinkster/react-redux-realworld-example-app)**

Fork: `https://github.com/<your-team>/react-redux-realworld-example-app`

## Why this repo

| Criterion | Detail |
|---|---|
| Pinned at React 17 | `"react": "^17.0.2"` in package.json |
| Mix of class and functional components | Good variety for the demo |
| Contains `ReactDOM.render` in `src/index.js` | Triggers the highest-priority breaking change |
| Contains test files using `act` from `react-dom/test-utils` | Triggers react-bc-3 |
| ~40 source files | Large enough to be impressive; small enough to finish in demo time |
| Well-known app | Judges recognise it; demonstrates real-world applicability |
| Public + forkable | Can push a PR branch live during the demo |

## Pre-demo checklist

- [ ] Fork the repo to your GitHub account
- [ ] Confirm `GITHUB_TOKEN` has `repo` scope on the fork
- [ ] Run `analyze_dependency_usage` on the fork once before the demo (so the clone is cached)
- [ ] Confirm `calculate_migration_blast_radius` returns ≥ 5 high-risk files
- [ ] Delete the migration branch from the fork before the live demo (`git push origin --delete codebase-doctor/react-18-upgrade`)
- [ ] Time the full end-to-end run — target ≤ 6 minutes for the live demo

## Expected blast radius (reference)

| File | Expected risk score |
|---|---|
| `src/index.js` | 85–95 (contains `ReactDOM.render`) |
| `src/index.test.js` | 50–60 (uses `act`) |
| Components using `useState` only | 10–20 |
