# Codebase Doctor — Feature Screenshots

Every image here was captured from the **running application** on 2026-09-26 by
[`scripts/screenshots/capture.mjs`](../scripts/screenshots/capture.mjs). The captures come from three places:

| Source | What it is | Why |
|---|---|---|
| **Migration report** (`generate_report`, HTML) | The artifact Bob renders with `create_html_artifact`, as written by the tool during the recorded end-to-end run (`.demo-run/reports/*.html`), opened unchanged in Chrome | The product's own visual surface |
| **MCP Inspector → Codebase Doctor** | The official MCP Inspector v2.8.0 (a generic MCP client UI) connected over stdio to the built server; every result is the server's live reply | Bob IDE cannot be automated from this environment; this shows the exact tool output Bob receives (the Inspector shows Markdown raw, Bob renders it) |
| **GitHub sandbox record** | A local page showing the pull request exactly as the tool sent it to a **mocked GitHub API**, plus the commits pushed to a local bare repository | No real GitHub repository/token was authorized for this audit. It is labelled "not GitHub" on the page itself |

**Data:** the React 17 demo app in [`examples/react17-demo-app`](../examples/react17-demo-app/README.md), migrated
to React 18.3.1 with a real `npm install` and real Jest / ESLint / esbuild runs. The migration guide PDF in `docs/`
was supplied as docs text.

**Capture adjustments (layout only, never content):** for single-section shots of the report, the sticky top bar
is unpinned so it doesn't cover the section. For long Inspector results, the browser window is made taller so
the whole result fits. Interactive states (filters, search, expand-all, theme, keyboard focus) were produced by
using the page.

**Secrets:** no screenshot contains a token. Runs used either no `GITHUB_TOKEN` or a sandbox placeholder that is
never displayed. Local absolute paths appear in a few Inspector inputs and errors, because the demo repository
path is part of the request.

**Not captured here:** Bob IDE itself. Real Bob sessions from development are in
[`docs/bob-evidence/`](../docs/bob-evidence/). They show an earlier version of the server.

---

## 01 · Overview

| File | Shows |
|---|---|
| `01-overview/report-final-state-pr-open.png` | Report at the end of the run: all eight stages done, "Pull request open", vitals (11 files use react, 9 need attention, 8 breaking changes, verification passed), risk ranking |
| `01-overview/mcp-server-connected-over-stdio.png` | The Codebase Doctor server connected over stdio (MCP 2025-11-25) |
| `01-overview/mcp-tools-list.png` | The 12 tools the server advertises |

## 02 · Repository connection

| File | Shows |
|---|---|
| `02-repository-connection/analyze-repository-form.png` | `analyze_dependency_usage` input form, generated from the server's schema (repository, dependency, target version) |
| `02-repository-connection/analyze-repository.png` | Result: session created, repository and branch, package manager, 13 files scanned, family usage, commands, peer conflict `@testing-library/react@12.1.5` |
| `02-repository-connection/error-unsupported-host.png` | A GitLab URL rejected, with the accepted formats |
| `02-repository-connection/error-dist-tag-instead-of-version.png` | `latest` rejected: a concrete version is needed |
| `02-repository-connection/error-not-a-git-repository.png` | A folder without `.git` rejected |
| `02-repository-connection/error-dependency-not-declared.png` | `vue` is not declared; the half-created session and clone are removed |
| `02-repository-connection/error-invalid-session-id-schema.png` | MCP input validation rejects a non-UUID session ID before any tool code runs |

## 03 · Repository analysis

| File | Shows |
|---|---|
| `03-repository-analysis/report-after-analysis.png` | Report right after analysis: stage 1 done, "Analysed", next action, empty states for later stages |
| `03-repository-analysis/affected-files-explorer.png` | Every file using react/react-dom, with line, API, source line and rule chips; high-risk files expanded |
| `03-repository-analysis/affected-files-filter-high-risk.png` | Tier filter set to "High" |
| `03-repository-analysis/affected-files-search-legacy.png` | Path filter "legacy" + "Expand all" |
| `03-repository-analysis/repository-details.png` | Language, package manager, commands, files scanned, rule set, session |
| `03-repository-analysis/empty-state-rules-not-loaded.png` | Honest empty state before rules are loaded |

## 04 · Risk & prioritization

| File | Shows |
|---|---|
| `04-risk-and-prioritization/risk-distribution-and-ranking.png` | Tier bar (4 high, 0 medium, 5 low, 2 stable) and ranked files with the scorer's breakdown (`react-bc-1 +40, react-bc-8 +20, root bootstrap +30`) |
| `04-risk-and-prioritization/blast-radius-tool-result.png` | `calculate_migration_blast_radius` output |

## 05 · Migration knowledge

| File | Shows |
|---|---|
| `05-migration-knowledge/load-requirements-validated-by-guide.png` | 8 applicable rules; each marked `[in docs]` / `[not in docs]` against the React 18 guide PDF text |
| `05-migration-knowledge/breaking-changes-with-docs-validation.png` | Rule cards: severity, automated/manual, "confirmed by docs", files, how-to-fix guidance |
| `05-migration-knowledge/peer-dependency-compatibility.png` | Peer preflight: RTL 12 (`react <18.0.0`) found in the lockfile, upgraded to ^14.3.1 by the dependency step |

## 06 · Migration planning

| File | Shows |
|---|---|
| `06-migration-planning/generate-plan-tool-result.png` | The plan as returned to Bob: plan ID, effort, a 10-step table, step details, "type approved" |
| `06-migration-planning/plan-awaiting-approval.png` | Plan in the report: approval banner, ordered steps, package edits with reasons |

## 07 · Approval workflow

| File | Shows |
|---|---|
| `07-approval-workflow/report-awaiting-approval.png` | Report stage tracker on "Approve", next action: reply "approved" |
| `07-approval-workflow/nothing-changed-before-approval.png` | Changes section: nothing changed, and the backend refuses until approval |
| `07-approval-workflow/checkout-blocked-before-approval.png` | `checkout_branch` refused before approval |
| `07-approval-workflow/apply-blocked-before-approval.png` | `apply_migration_patch` refused before approval |
| `07-approval-workflow/approval-refused-not-approved.png` | "looks good but skip the tests" is not an approval |
| `07-approval-workflow/approval-recorded.png` | Approval recorded against the plan ID |
| `07-approval-workflow/migration-branch-created.png` | `checkout_branch` after approval |

## 08 · Migration execution

| File | Shows |
|---|---|
| `08-migration-execution/codemod-applied-with-diffstat.png` | `react-bc-1` transform applied to 3 files, no remaining usages, diff stat |
| `08-migration-execution/rerun-is-a-no-op.png` | Re-running a processed step changes nothing |
| `08-migration-execution/manual-step-reported-as-manual-required.png` | A review rule makes no edits and is reported as `manual_required` |
| `08-migration-execution/skip-requires-a-reason.png` | Skipping without a note is refused |
| `08-migration-execution/dependency-step-cannot-be-skipped.png` | The dependency step can never be skipped |
| `08-migration-execution/session-status-next-action.png` | `get_session_status`: every step's status and the next action |
| `08-migration-execution/plan-steps-in-progress.png` | Report plan mid-migration: applied / manual-required steps with commits |
| `08-migration-execution/remaining-manual-work.png` | Remaining work with how-to-fix guidance |
| `08-migration-execution/peer-conflict-flagged-before-install.png` | Side session (the demo app pinned to a `react-redux` release whose peer range stops at React 17): the preflight flags it and suggests the lowest compatible release |
| `08-migration-execution/report-step-failed.png` | Same session after the user skipped the warning: the real `npm install` failed, and the "Implement" stage is blocked with "Step failed" |
| `08-migration-execution/failed-step-rolled-back-with-output.png` | The failed dependency step: rolled back, diagnosis naming `react-redux` and the peer range it needs, npm's output |
| `08-migration-execution/retry-succeeded-after-fix.png` | After upgrading `react-redux` (recorded on the peer step), the dependency step succeeded on attempt 2 |

## 09 · Code diff review

| File | Shows |
|---|---|
| `09-code-diff-review/per-step-commits-and-diffs.png` | One commit per step with diff stat and coloured diff; lockfile diff summarised |

## 10 · Verification

| File | Shows |
|---|---|
| `10-verification/verification-failed-lint-and-test.png` | Iteration 1 failed for real: ESLint `react/no-deprecated` (`unmountComponentAtNode`) and 1 Jest test (automatic batching); diagnosis and output |
| `10-verification/report-verification-failed.png` | Report at "Verification failed" |
| `10-verification/verification-passed-with-history.png` | History #1 failed → #2 passed; installed versions + lint + test + build all PASS |
| `10-verification/verify-migration-passed.png` | `verify_migration` re-run live on the finished session (real Jest/ESLint/esbuild) |

## 11 · Reports

| File | Shows |
|---|---|
| `11-reports/report-final-full-page-light.png` | The complete report, light theme |
| `11-reports/report-final-full-page-dark.png` | The complete report, dark theme |
| `11-reports/measured-estimated-not-measured.png` | Measured values, labelled estimates, and what is not measured |
| `11-reports/nothing-left-open.png` | Remaining work once every step is done |
| `11-reports/markdown-report-for-pr-body.png` | `generate_report` in Markdown (the PR body) |

## 12 · GitHub integration (sandbox)

| File | Shows |
|---|---|
| `12-github-integration/sandbox-pull-request-top.png` | **Sandbox, not GitHub:** PR title, head → base, labels, the commits that were pushed |
| `12-github-integration/sandbox-pull-request-full-body.png` | **Sandbox:** the full PR body the tool sent |
| `12-github-integration/report-links-pull-request.png` | Report header linking the PR |
| `12-github-integration/pr-blocked-steps-not-run.png` | `create_pull_request` refused: steps never executed |
| `12-github-integration/pr-already-open-idempotent.png` | Retry returns the existing PR instead of opening a duplicate |

## 13 · Error and recovery states

| File | Shows |
|---|---|
| `13-error-and-recovery-states/report-verification-untrusted.png` | Report when `checks-result.json` was written by hand: "Verification untrusted" |
| `13-error-and-recovery-states/hand-written-verification-rejected.png` | The verification section rejecting the unsealed file |
| `13-error-and-recovery-states/integrity-check-flags-hand-written-state.png` | `get_session_status` flagging the same file |
| `13-error-and-recovery-states/list-recent-sessions.png` | Recovery after a context reset: recent sessions |
| `13-error-and-recovery-states/unknown-session.png` | An unknown session ID, with the next step |

## 14 · Responsive layouts, theming, accessibility

| File | Shows |
|---|---|
| `14-responsive-layouts/desktop-dark-mode.png` | System dark mode |
| `14-responsive-layouts/theme-toggle-dark.png` | Theme toggle set to "dark" |
| `14-responsive-layouts/tablet-834.png` | Tablet: section nav as chips, single column |
| `14-responsive-layouts/mobile-390-hero.png` | Phone: header, stage tracker in two rows, vitals in two columns |
| `14-responsive-layouts/mobile-390-plan.png` | Phone: migration plan |
| `14-responsive-layouts/mobile-390-files.png` | Phone: file explorer |
| `14-responsive-layouts/mobile-390-dark-verification.png` | Phone, dark: verification failure |
| `14-responsive-layouts/keyboard-focus-visible.png` | Keyboard navigation: visible focus ring on a filter chip |

---

## Coverage

| Feature | Covered by |
|---|---|
| Repository input and validation | 02 |
| Analysis, affected files, compatibility | 03, 05 |
| Risk and prioritization | 04 |
| Knowledge base and docs validation | 05 |
| Plan and approval gate | 06, 07 |
| Execution: automated, manual, skip, failure, retry, idempotency | 08 |
| Diffs | 09 |
| Verification (fail → pass) | 10 |
| Reports (HTML, Markdown, metrics) | 11 |
| Pull request gates and idempotency | 12 (sandbox) |
| Tamper evidence and recovery | 13 |
| Responsive, dark mode, keyboard focus | 14 |

**Not covered:** a real pull request on github.com, and Bob IDE's own chat/plan/todo UI for this version (see
`docs/bob-evidence/` for earlier real sessions).
