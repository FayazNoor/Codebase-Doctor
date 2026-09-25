# Demo Script

**Total target time: 7 minutes**  
**Demo migration:** React 17 → 18 on [`FayazNoor/react-redux-realworld-example-app`](https://github.com/FayazNoor/react-redux-realworld-example-app)

---

## Pre-Demo Checklist (do off-screen)

- [ ] Bob IDE open, **Agent mode** active
- [ ] `codebase-doctor` MCP server shows connected in Bob's MCP server list
- [ ] `GITHUB_TOKEN` exported in terminal (PAT with `repo` scope)
- [ ] Fork of `react-redux-realworld-example-app` ready — migration branch deleted
- [ ] React 18 migration guide PDF downloaded ([react.dev](https://react.dev/blog/2022/03/08/react-18-upgrade-guide))
- [ ] Run `analyze_dependency_usage` once before demo so clone is cached (speeds up live run)
- [ ] Screen recording software running

---

## [0:00 – 0:30] Opening (30 sec)

**Say:**
> "Upgrading a major dependency in an unfamiliar codebase takes a senior engineer a full day.
> Codebase Doctor does it in minutes — using IBM Bob 2.0's Agent mode, Plan mode,
> parallel subagents, document understanding, and a custom skill, all working together."

**Show:** The Bob IDE, Agent mode active, empty chat.

---

## [0:30 – 1:30] Kickoff (1 min)

**Type into Bob Agent mode chat:**
```
Upgrade react from 17 to 18 in https://github.com/FayazNoor/react-redux-realworld-example-app
Here are the React 18 migration docs: @react18-migration-guide.pdf
```

**Say:**
> "The `migration-doctor` skill auto-activates — I didn't type a slash command.
> Bob calls `analyze_dependency_usage` and `load_migration_requirements`.
> Notice the PDF is attached natively — that's Bob's document understanding."

**Screenshot:** Skill activation + PDF attachment

---

## [1:30 – 2:30] Parallel subagents (1 min)

**Show:** Two subagent breadcrumbs appearing simultaneously.

**Say:**
> "Two subagents run in parallel — one scanning the AST, one parsing the migration docs.
> They return compact summaries back to the main context.
> The repo files never enter main context — this keeps Bobcoin costs down."

**Screenshot:** Both subagent breadcrumbs visible at the same time

---

## [2:30 – 3:30] Blast radius + Plan mode (1 min)

**Show:** Bob switching to Plan mode; blast radius output; migration plan in chat.

**Say:**
> "Bob switches to Plan mode. It calculates blast radius — 8 high-risk files —
> then generates a prioritised migration plan. The skill reads `migration-checklist.md`
> to verify every category is covered before presenting it."

**Screenshot:** Plan mode active + migration plan Markdown in chat

**Type:** `approved`

---

## [3:30 – 5:00] Implementation (1:30 min)

**Show:** Todo list ticking off; subagent breadcrumbs for high-risk files.

**Say:**
> "Back in Agent mode. The checklist becomes a live todo list.
> For `src/index.js` — our highest-risk file, score 90/100 — Bob spawns a
> targeted subagent to read it before patching. Low-risk files are applied directly."

**Screenshot:** Todo list with items in progress + completed

---

## [5:00 – 6:00] Verify loop (1 min)

**Show:** `verify_migration` output — one test fails; subagent diagnoses; fix applied; rerun passes.

**Say:**
> "`verify_migration` runs lint, test, and build. One test fails — the `act()` import
> from the old location. A subagent diagnoses it and proposes a one-line fix.
> Second run: all green."

**Screenshot:** Failed verification → subagent diagnosis → passing verification

---

## [6:00 – 7:00] Report + PR (1 min)

**Show:** HTML migration report artifact; PR URL.

**Say:**
> "`generate_report` builds the before/after report.
> 37 files changed. 7 breaking changes addressed. 6 minutes versus an estimated 18-hour manual effort.
> `create_pull_request` opens the PR live on GitHub."

**Screenshot:** HTML artifact (productivity metrics table) + GitHub PR page

**Closing:**
> "One prompt. Seven minutes. React 17 to 18.
> Fully tested, reviewed, and PR'd — with IBM Bob 2.0."

---

## Backup Plans

| Problem | Recovery |
|---|---|
| MCP server crashes | Session state is on disk — restart server, re-run the last tool |
| GitHub API fails | Show blast radius report + migration plan; skip PR creation |
| Demo runs long | Cut implementation narration; just show the todo list ticking |
| Subagent takes too long | Narrate what it's doing; the wait reinforces "real work is happening" |

---

## Key Screenshot Moments

| # | Moment | Bob feature shown |
|---|---|---|
| 1 | Skill auto-activates (no slash command) | Custom skill |
| 2 | PDF attachment in chat | Document understanding |
| 3 | Two subagent breadcrumbs simultaneously | Parallel subagents |
| 4 | Plan mode badge + migration plan | Plan mode |
| 5 | Todo list ticking off during implementation | Agent mode + todo list |
| 6 | Failed verify → subagent diagnosis → passing | Iterative loop + subagent |
| 7 | HTML artifact with productivity metrics | HTML artifact |
| 8 | Live GitHub PR | End-to-end completion |
