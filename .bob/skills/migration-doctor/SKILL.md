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
performs AST-level analysis to find every usage of the dependency.

The tool returns a compact session summary string and a `sessionId`. Save the
`sessionId` — it is required for all subsequent steps.

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
the `docsText` parameter. Otherwise the tool will use the seeded knowledge base.

Call with `{ sessionId, docsText? }`.

Spawn an `explore` subagent to call `load_migration_requirements` and return:
- A bullet list of every breaking change that applies to THIS repo
- Which breaking changes are automatable vs. require manual edits
- Any codemod packages available

Steps 1 and 2 subagents can run **in parallel** — spawn both at the same time.

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

Do **not** proceed to Step 5 until the user explicitly approves.

---

## Step 5 — Implement Changes

**Mode:** Switch back to **Agent mode**.

Use `migration-checklist.md` as the template for the todo list. Create a
`update_todo_list` with one item per checklist step.

1. Call `checkout_branch` with `{ sessionId }` to create the migration branch.
2. For each `MigrationStep` in the approved plan:
   a. For **high-risk files** (risk score ≥ 70): spawn an `explore` subagent
      to read the files deeply and return the exact patterns that need changing.
      Maximum 3 subagents in parallel.
   b. For **medium / low-risk files**: apply directly without a subagent.
   c. Call `apply_migration_patch` with `{ sessionId, stepId }`.
   d. Mark the todo item complete.
3. Continue until all steps are applied.

---

## Step 6 — Verify Migration

**Mode:** Agent  
**MCP tool:** `verify_migration`

Call with `{ sessionId }`. The tool runs lint, test, and build and returns a
structured `ChecksResult`.

**If all checks pass:** proceed to Step 7.

**If any check fails (max 3 iterations):**
1. Spawn a `general` subagent with `fork_context: true`.
   Task: "Diagnose these failures and propose the minimal code fix:
   {failureSummary}. Do not change anything outside the reported failure scope."
2. Apply the subagent-proposed fixes using `apply_migration_patch`.
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

2. Call `generate_report` with `{ sessionId }` to produce the before/after
   migration report. Render it using `create_html_artifact` with:
   - Title: "{dependency} {fromVersion}→{toVersion} Migration Report"
   - Metrics table: files changed, tests passing, Bobcoin cost, wall-clock time
   - Blast radius breakdown
   - Breaking changes addressed (checklist)

3. Call `create_pull_request` with `{ sessionId }` to open the PR.

4. Present the PR URL and the HTML artifact to the user.

---

## Context Efficiency Rules

- Never read full file contents in the main context — use `explore` subagents.
- Pass only compact summaries (≤ 500 chars) between subagents and the main context.
- Reset the conversation if the message count exceeds 30 without progress.
- Read `migration-checklist.md` and `severity-guide.md` only at the step that
  needs them, never upfront.
