---
name: migration-doctor
description: >
  Use when the user wants to upgrade, migrate, bump, or update a dependency
  or package to a new version — guides the full Codebase Doctor workflow:
  analyse usages, load migration requirements, calculate blast radius, generate
  a migration plan for approval, implement changes, verify with lint/test/build,
  and open a pull request.
---

# Migration Doctor

Follow these steps **in order**. Do not skip steps. Do not begin implementation
before the user approves the migration plan in Step 4.

## Prerequisites

Confirm the following are available before starting:
- The `codebase-doctor` MCP server is connected (check MCP server list).
- `GITHUB_TOKEN` is set in the environment.
- The user has provided: repo URL, dependency name, and target version.
- Migration documentation is available (attached file, URL, or use the seeded
  knowledge base for React 17→18 / Express 4→5).

Ask for anything missing using `ask_followup_question` before proceeding.

---

## Step 1 — Analyse Dependency Usage

**Mode:** Agent  
**MCP tool:** `analyze_dependency_usage`

Call the tool with `{ url, dependency, targetVersion }`. It clones the repo,
detects the package manager, test framework, and build/lint/test commands, and
performs AST-level analysis of the dependency's package family (for React:
`react`, `react-dom`, `react-dom/client`, `react-dom/test-utils`) — import sites
plus concrete API usages such as `ReactDOM.render(...)` calls.

The tool returns a compact session summary string and a `sessionId`. Save the
`sessionId` — it is required for all subsequent steps. Each call creates a NEW
session; to resume after a context reset, reuse the saved `sessionId`.

Spawn an `explore` subagent to call `analyze_dependency_usage` and return only:
- The `sessionId`
- The top 10 highest-risk files (with risk score and reason)
- Detected package manager, test command, build command

The subagent should read `severity-guide.md` (in this skill directory) to
interpret risk scores consistently.

---

## Step 2 — Load Migration Requirements

**Mode:** Agent  
**MCP tool:** `load_migration_requirements`

If the user attached a PDF or document, extract its text first and pass it as
the `docsText` parameter. For supported migrations (React 17→18, Express 4→5)
the built-in knowledge base stays canonical: the docs confirm or augment its
rules (canonical IDs like `react-bc-1` are kept, so automated transforms still
apply) and any extra requirement found only in the docs becomes a manual
`docs-N` item.

Call with `{ sessionId, docsText? }`.

Spawn an `explore` subagent to call `load_migration_requirements` and return:
- A bullet list of every breaking change that applies to THIS repo
- Which breaking changes are automatable vs. require manual edits
- Any codemod packages available

Step 2 needs the `sessionId` from Step 1, so start it as soon as Step 1
returns. If the user attached a document, a subagent can extract its text in
parallel with Step 1.

---

## Step 3 — Calculate Blast Radius

**Mode:** Agent  
**MCP tool:** `calculate_migration_blast_radius`

Call with `{ sessionId }`. The tool returns a `BlastRadiusReport` with:
- Total files affected
- Risk distribution (high / medium / low)
- Top affected files ranked by risk score

Present the blast radius as a summary in chat. If more than 50 files are at
high risk, flag this to the user before continuing.

---

## Step 4 — Generate Migration Plan and Seek Approval

**Mode:** Switch to **Plan mode** for this step.

Call `generate_migration_plan` with `{ sessionId }`. Before presenting the plan
to the user, read `migration-checklist.md` (in this skill directory) and verify
that every checklist category is represented in the generated plan steps. If
any category is missing, add the relevant step.

Present the plan to the user as formatted Markdown. The plan must include:
- Executive summary of the migration
- Estimated effort (low / medium / high)
- Ordered list of migration steps, each with: title, affected files, change
  type (codemod / manual / config / test), and whether it is automatable

Ask the user: **"Does this migration plan look correct? Type 'approved' to
proceed or describe any changes."**

Do **not** proceed to Step 5 until the user explicitly approves. When the user
replies "approved", call `approve_migration_plan` with
`{ sessionId, planId, confirmation: "approved" }` (the `planId` is printed in
the plan). The backend enforces this gate: `checkout_branch`,
`apply_migration_patch` and `create_pull_request` refuse to run until the
approval is recorded. Never call `approve_migration_plan` on the user's behalf.

---

## Step 5 — Implement Changes

**Mode:** Switch back to **Agent mode**.

Use `migration-checklist.md` as the template for the todo list. Create a
`update_todo_list` with one item per checklist step.

1. Call `checkout_branch` with `{ sessionId }` to create the migration branch.
2. Call `apply_migration_patch` for each step **in plan order** (the dependency
   step runs the package-manager install; some transforms need the new version
   installed). Each call returns an honest status:
   - `applied` — the tool changed code/config and found no leftovers.
   - `manual_required` — manual rule, test step, or automation left usages it
     could not migrate safely (they are listed).
   - `not_applicable` — nothing to do.
3. For each `manual_required` step:
   a. For **high-risk files** (risk score ≥ 70): spawn an `explore` subagent
      to read the files and return the exact patterns that need changing.
      Maximum 3 subagents in parallel.
   b. Make the change (or, for review items such as automatic batching, do the
      audit), then call `apply_migration_patch` with
      `{ sessionId, stepId, markManualComplete: true, note: "<what was done>" }`.
      For code rules the tool refuses if the old pattern is still present.
   c. If a manual item is deliberately left for the PR reviewer, leave it as
      `manual_required` — the report and PR will say so. Never describe it as done.
4. Mark each todo item complete only when its step is `applied`,
   `completed_manual` or `not_applicable`.

---

## Step 6 — Verify Migration

**Mode:** Agent  
**MCP tool:** `verify_migration`

Call with `{ sessionId }`. The tool checks that `node_modules` holds the
upgraded packages (e.g. `react` and `react-dom` at the same 18.x version), runs
lint, test, and build, and reports PASS / FAIL / SKIPPED for each. Verification
only passes if nothing failed and at least one of lint/test/build actually ran.
The result is recorded against the current commit.

**If all checks pass:** proceed to Step 7.

**If any check fails (max 3 iterations):**
1. Spawn a `general` subagent with `fork_context: true`.
   Task: "Diagnose these failures and propose the minimal code fix:
   {failureSummary}. Do not change anything outside the reported failure scope."
2. Apply the subagent-proposed fixes, then record them on the relevant step
   with `apply_migration_patch` (`markManualComplete: true` + `note`).
3. Call `verify_migration` again.
4. If still failing after 3 iterations, surface the failures to the user with
   a diagnosis and ask whether to continue manually or abort.

---

## Step 7 — Code Review, Report & Pull Request

**Mode:** Agent

1. Spawn a `general` subagent with `fork_context: true` to perform a code
   review of the migration diff. It should return:
   - Any migration step that was applied incorrectly
   - Any test coverage gaps for changed behaviour
   - A one-line overall verdict (approved / needs changes)

2. Call `generate_report` with `{ sessionId, format: "html" }` and render it
   using `create_html_artifact` with the title
   "{dependency} {fromVersion}→{toVersion} Migration Report". Show it as is:
   the report already separates measured values (lint/test/build results,
   files changed, step statuses, elapsed time), labelled estimates (manual
   effort, time saved) and metrics that are not measured (Bobcoin usage,
   accuracy). Do not add numbers that the report does not contain.

3. Call `create_pull_request` with `{ sessionId }` to open the PR. It refuses
   unless the latest `verify_migration` passed on the current commit and every
   step has been executed; if it refuses, follow the error's next step.
   Re-calling it returns the existing PR instead of opening a duplicate.

4. Present the PR URL and the HTML artifact to the user.

---

## Context Efficiency Rules

- Never read full file contents in the main context — use `explore` subagents.
- Pass only compact summaries (≤ 500 chars) between subagents and the main context.
- Reset the conversation if the message count exceeds 30 without progress.
- Read `migration-checklist.md` and `severity-guide.md` only at the step that
  needs them, never upfront.
