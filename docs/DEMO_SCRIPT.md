# Demo Script

**Total target time: 7 minutes**  
**Demo migration:** React 17 → 18 — target repository **not ready yet** (see [`target-repo.md`](target-repo.md);
the planned fork `FayazNoor/react-redux-realworld-example-app` does not exist yet and the source repo is on React 16).

> **All numbers in this script are placeholders or targets, not results.** No real end-to-end demo
> run has happened yet. Replace every `[measured: …]` with the value from the real run's report.

---

## Pre-Demo Checklist (do off-screen)

- [ ] Bob IDE open, **Agent mode** active
- [ ] `codebase-doctor` MCP server shows connected in Bob's MCP server list
- [ ] `GITHUB_TOKEN` exported in terminal (PAT with `repo` scope)
- [ ] Demo repository prepared per `docs/target-repo.md` (fork created, baseline green) — migration branch deleted
- [ ] React 18 migration guide PDF downloaded ([react.dev](https://react.dev/blog/2022/03/08/react-18-upgrade-guide))
- [ ] Run `analyze_dependency_usage` once before demo so clone is cached (speeds up live run)
- [ ] Screen recording software running

---

## [0:00 – 0:30] Opening (30 sec)

**Say:**
> "Upgrading a major dependency in an unfamiliar codebase can take an engineer a day or more.
> Codebase Doctor automates the mechanical parts and is honest about the rest — using IBM Bob 2.0's
> Agent mode, Plan mode, subagents, document understanding, and a custom skill, all working together."

**Show:** The Bob IDE, Agent mode active, empty chat.

---

## [0:30 – 1:30] Kickoff (1 min)

**Type into Bob Agent mode chat:**
```
Upgrade react from 17 to 18.3.1 in <prepared demo repo URL>
Here are the React 18 migration docs: @react18-migration-guide.pdf
```

**Say:**
> "The `migration-doctor` skill auto-activates — I didn't type a slash command.
> Bob calls `analyze_dependency_usage`, which scans react and react-dom — including
> react-dom/client and react-dom/test-utils — for real API calls, not just imports.
> Notice the PDF is attached natively — that's Bob's document understanding. The built-in
> React 18 rules stay canonical; the PDF confirms them and can add manual items."

**Screenshot:** Skill activation + PDF attachment

---

## [1:30 – 2:30] Parallel subagents (1 min)

**Show:** Subagent breadcrumbs — repo analysis and PDF extraction running at the same time.

**Say:**
> "Independent work runs in parallel — one subagent analyses the repo while another extracts the
> migration docs. They return compact summaries back to the main context, so repo files never
> enter main context."

**Screenshot:** Both subagent breadcrumbs visible at the same time

---

## [2:30 – 3:30] Blast radius + Plan mode (1 min)

**Show:** Bob switching to Plan mode; blast radius output; migration plan in chat.

**Say:**
> "Bob switches to Plan mode. It calculates blast radius — [measured: N] high-risk files —
> then generates a prioritised migration plan. The skill reads `migration-checklist.md`
> to verify every category is covered before presenting it. Nothing is changed until I approve:
> the backend itself refuses to touch the repo before approval is recorded."

**Screenshot:** Plan mode active + migration plan Markdown in chat

**Type:** `approved` → Bob calls `approve_migration_plan` (show the confirmation line)

---

## [3:30 – 5:00] Implementation (1:30 min)

**Show:** Todo list ticking off; subagent breadcrumbs for high-risk files.

**Say:**
> "Back in Agent mode. The checklist becomes a live todo list. The first step upgrades react and
> react-dom together and runs the real package-manager install, updating the lockfile.
> For `[measured: highest-risk file]` — score [measured: N]/100 — Bob spawns a targeted subagent
> before patching. Manual items are marked 'requires manual action' until they are really done."

**Screenshot:** Todo list with items in progress + completed

---

## [5:00 – 6:00] Verify loop (1 min)

**Show:** `verify_migration` output (PASS / FAIL / SKIPPED per check, plus installed versions).

**Say (adapt to what actually happens):**
> "`verify_migration` first checks that react and react-dom 18 are really installed, then runs lint,
> test, and build. [If a check fails:] A subagent diagnoses the failure and proposes a minimal fix;
> Bob re-runs verification. [Only claim a fix loop if one actually happened on camera.]"

**Screenshot:** Failed verification → subagent diagnosis → passing verification

---

## [6:00 – 7:00] Report + PR (1 min)

**Show:** HTML migration report artifact; PR URL.

**Say:**
> "`generate_report` builds the report from real session data: [measured: N] files changed,
> [measured: N] steps fixed automatically, [measured: N] done manually, [measured: N] still needing a
> human — in [measured: N] minutes, against a manual-effort *estimate* of [estimate: N] hours.
> `create_pull_request` only opens the PR because verification passed on this exact commit."

**Screenshot:** HTML artifact (productivity metrics table) + GitHub PR page

**Closing:**
> "One prompt. React 17 to 18 — verified, reviewed, and PR'd with IBM Bob 2.0,
> with an honest record of what still needs a human." (Only say a duration if it was measured.)

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
| 3 | Subagent breadcrumbs (repo analysis + PDF extraction) | Parallel subagents |
| 4 | Plan mode badge + migration plan + approval recorded | Plan mode + approval gate |
| 5 | Todo list ticking off during implementation | Agent mode + todo list |
| 6 | verify_migration result (fix loop only if it really occurs) | Iterative loop + subagent |
| 7 | HTML artifact with productivity metrics | HTML artifact |
| 8 | Live GitHub PR | End-to-end completion |
