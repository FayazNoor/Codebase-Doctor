# Video Notes

## Demo Video Structure (target: 7 minutes)

See [`docs/DEMO_SCRIPT.md`](../docs/DEMO_SCRIPT.md) for the full script with exact narration.

---

## Timestamp Guide

| Time | Section | Key visual |
|---|---|---|
| 0:00 – 0:30 | Opening | Bob IDE, Agent mode active, empty chat |
| 0:30 – 1:30 | Kickoff | Skill auto-activates; PDF attachment; MCP tool calls begin |
| 1:30 – 2:30 | Parallel subagents | Repo analysis + PDF extraction subagents visible at the same time |
| 2:30 – 3:30 | Blast radius + Plan mode | Plan mode badge; migration plan markdown; user types "approved" → approval recorded |
| 3:30 – 5:00 | Implementation | Todo list ticking off; high-risk file subagent breadcrumb |
| 5:00 – 6:00 | Verify loop | verify_migration PASS/FAIL/SKIPPED (show a fix loop only if it really happens) |
| 6:00 – 7:00 | Report + PR | HTML artifact with metrics; live GitHub PR URL |

---

## Results to Highlight

Current, verifiable facts (2026-09-26):

- **241 tests** passing — 222 unit + 19 integration (`npm test`, no network needed; counted 2026-09-26)
- **12 MCP tools** registered and callable independently
- React 17 → 18: **12 knowledge-base rules** — **3 automated transforms** (`ReactDOM.render` → `createRoot`,
  `ReactDOM.hydrate` → `hydrateRoot`, `act` import) and **9 manual/review rules** tracked honestly
- Backend-enforced approval gate; PR creation requires passing verification on the current commit

Measured in the **scripted** end-to-end run on `examples/react17-demo-app` (real MCP server over stdio, driven by
`backend/scripts/e2e-demo.mjs` — **not** the Bob recording; see [`docs/evidence/e2e-run/`](../docs/evidence/e2e-run/)):

- 8 rules applied (3 automated, 5 manual/review); a peer conflict (`@testing-library/react@12`) caught before install
- Verification #1 **failed** for real (lint + 1 test), #2 passed after the manual fixes; 9 files changed on the branch
- PR opened against a local sandbox, not github.com

From the live Bob demo run — **to be measured, do not quote before then**:

- Files changed, steps automatically / manually completed, steps left open → from the report
- Wall-clock time → measured by the report (target: ≤ 7 minutes). The scripted run's workflow took 139–400 s,
  mostly `npm install`; if the install is cut in the edit, say so on screen
- Manual-effort figure → always say "estimated"
- Bobcoin usage → only if read from Bob's UI during the run; the report does not measure it

---

## Bob Features to Call Out On-Screen

1. **Skill auto-activation** — no slash command, just natural language
2. **PDF document understanding** — migration guide attached directly in chat
3. **Parallel subagents** — two breadcrumbs at the same time
4. **Plan mode** — badge changes in the UI header
5. **Todo list** — checklist items ticking in real time
6. **Iterative verify loop** — Bob diagnoses and fixes failures itself (up to 3 rounds, then asks the user)
7. **HTML artifact** — shareable one-pager; metrics labelled measured / estimate / not measured

---

## Recording Checklist

- [ ] Screen resolution ≥ 1920×1080
- [ ] Bob IDE in light mode (better contrast for recording)
- [ ] Font size bumped to 15px in Bob settings
- [ ] Terminal hidden (PAT must not appear on screen)
- [ ] A **fresh** PAT in `.bob/mcp.json` (the earlier one appeared in a committed screenshot and must be revoked)
- [ ] Microphone tested; no background noise
- [ ] Demo repo prepared per `docs/target-repo.md` (`examples/react17-demo-app` pushed to your GitHub account,
      baseline green, no prior migration branch or PR)
- [ ] No live repository authorized? Skip the PR step (see the backup plans in `docs/DEMO_SCRIPT.md`) — do not
      present the local sandbox PR as a GitHub PR
- [ ] MCP server running and connected before recording starts
