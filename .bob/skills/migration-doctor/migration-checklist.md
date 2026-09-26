# Migration Doctor — Canonical Checklist

This checklist is the authoritative list of every action in a dependency
migration. Bob uses it in two ways:
1. **Plan validation (Step 4):** verify the generated migration plan covers
   every applicable category before presenting it to the user.
2. **Todo list template (Step 5):** each applicable item becomes a todo entry
   so progress is visible during implementation.

Mark items N/A if they do not apply to the specific migration (e.g., no class
components in a React project means "Migrate class component lifecycle methods"
is N/A).

---

## Category 1 — Pre-flight

- [ ] Repo cloned and session created
- [ ] Dependency current version detected from `package.json` / lockfile
- [ ] Package manager identified (npm / yarn / pnpm)
- [ ] Test command confirmed (`npm test` / `yarn test` / `vitest` / etc.)
- [ ] Build command confirmed
- [ ] Lint command confirmed
- [ ] Plan approved by the user and recorded with `approve_migration_plan`
- [ ] Migration branch created (`codebase-doctor/{dep}-{version}-upgrade`)

## Category 2 — Dependency Version Update

- [ ] Update target dependency version in `package.json`
- [ ] Keep companion packages in lock-step (e.g. `react-dom`, `react-test-renderer` at the same version as `react`; `@types/react*` at the same major) — only packages already declared
- [ ] Install updated packages (`npm install` / `yarn install` / `pnpm install`) and commit the updated lockfile
- [ ] Confirm the installed versions in `node_modules` match the target (checked by `apply_migration_patch` and `verify_migration`)
- [ ] If install fails on a peer-dependency conflict, upgrade the conflicting library deliberately (it is not changed automatically)

## Category 3 — Breaking API Changes

- [ ] Replace removed / renamed APIs at all usage sites
- [ ] Update function signatures that changed (argument order, added required args)
- [ ] Replace deprecated patterns flagged as errors in new version
- [ ] Update named exports that were moved or split

## Category 4 — Configuration & Bootstrapping

- [ ] Update framework bootstrapping code (e.g., `ReactDOM.render` → `createRoot`)
- [ ] Update config files affected by the new version (e.g., `vite.config`, `jest.config`)
- [ ] Apply new required provider or wrapper components
- [ ] Update TypeScript types if the package ships updated type definitions

## Category 5 — Concurrent / Async Behaviour Changes

- [ ] Audit code that relied on synchronous batching now changed to async
- [ ] Update `act()` wrappers in tests (if applicable)
- [ ] Fix any strict-mode violations surfaced by new version's stricter checks

## Category 6 — Test Updates

- [ ] Update test utilities or testing-library adapters for new version
- [ ] Fix tests broken by changed async/render behaviour
- [ ] Add regression tests for each breaking change that was addressed
- [ ] Confirm test suite passes in full after migration

## Category 7 — Lint & Build Verification

- [ ] Lint passes with zero new errors
- [ ] TypeScript compiles with zero new errors (if applicable)
- [ ] Build succeeds

## Category 8 — Code Review

- [ ] Subagent code review: no migration step applied incorrectly
- [ ] Subagent code review: no test coverage gaps for changed behaviour
- [ ] Review verdict recorded (approved / needs changes)

## Category 9 — Pull Request

- [ ] Before/after migration report generated
- [ ] Latest `verify_migration` passed on the current commit (required by `create_pull_request`)
- [ ] PR opened on migration branch targeting default branch
- [ ] PR body includes blast radius stats, each breaking change with its real status, and test results
- [ ] PR labelled `codebase-doctor` and `dependencies`
