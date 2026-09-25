# Demo Walkthrough Script

**Total target time: 7 minutes**

---

## Before you start (off-screen)

1. Bob IDE open, Agent mode active
2. MCP server connected (`codebase-doctor` shows in MCP server list)
3. `GITHUB_TOKEN` exported in terminal
4. Fork of `react-redux-realworld-example-app` ready (migration branch deleted)
5. React 18 migration guide PDF downloaded ([official](https://react.dev/blog/2022/03/08/react-18-upgrade-guide))

---

## [0:00] Opening (30 sec)

**Say:**
> "Upgrading a major dependency in an unfamiliar codebase takes a senior engineer a full day.
> Codebase Doctor does it in minutes using IBM Bob 2.0 — Agent mode, Plan mode, parallel subagents,
> document understanding, and a custom skill — all working together."

---

## [0:30] Kickoff prompt (1 min)

**Type into Bob Agent mode chat:**
```
Upgrade react from 17 to 18 in https://github.com/<your-fork>/react-redux-realworld-example-app
Here are the React 18 migration docs: @react18-migration-guide.pdf
```

**Say:**
> "The migration-doctor skill auto-activates — no slash command needed.
> Bob calls analyze_dependency_usage and load_migration_requirements.
> Notice it also attaches the PDF natively — that's Bob's document understanding."

**Wait for:** Two subagent breadcrumbs to appear (parallel analysis).

---

## [1:30] Parallel subagents (1 min)

**Say:**
> "Two subagents running in parallel — one analysing the AST usages in the repo,
> one parsing the migration docs. They return compact summaries so the main context
> stays lean and Bobcoins are conserved."

**Wait for:** Both subagents to complete and blast radius summary to appear.

---

## [2:30] Plan mode (1 min)

**Say:**
> "Bob switches to Plan mode. It calls calculate_migration_blast_radius —
> 8 high-risk files — then generate_migration_plan.
> The skill reads migration-checklist.md to validate every category is covered."

**Show:** The formatted migration plan in the chat.

**Type:** `approved`

---

## [3:30] Implementation (1:30 min)

**Say:**
> "Back in Agent mode. The skill's checklist becomes a live todo list.
> For the highest-risk files — like src/index.js — Bob spawns a targeted subagent
> to read them before applying the patch. Low-risk files are updated directly."

**Show:** Todo list ticking off as steps are applied.

---

## [5:00] Verification loop (1 min)

**Say:**
> "verify_migration runs lint, test, and build.
> One test fails — act() import from the old location.
> A subagent diagnoses the failure and proposes a one-line fix."

**Show:** The fix being applied and `verify_migration` called again — all green.

---

## [6:00] Report + PR (1 min)

**Say:**
> "generate_report builds the before/after report — 37 files changed,
> 8 breaking changes addressed, 4 minutes vs. an estimated 18-hour manual effort.
> create_pull_request opens the PR live."

**Show:** HTML artifact migration report + PR URL.

**Closing:**
> "One command. Seven minutes. React 17 to 18. Fully tested, reviewed, and PR'd —
> with IBM Bob 2.0."

---

## Backup plan (if anything breaks)

- If MCP server crashes: session data is on disk — restart server and re-run the last tool.
- If GitHub API fails: show the blast radius report and migration plan — these are the most
  impressive outputs. Skip the PR creation.
- If demo runs long: cut the implementation phase narration; just show the todo list ticking.
