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

- **141 tests** passing — 126 unit + 15 integration (`npm test`, no network needed)
- **11 MCP tools** registered and callable independently
- React 17 → 18: **3 automated transforms** (`ReactDOM.render` → `createRoot`, `ReactDOM.hydrate` →
  `hydrateRoot`, `act` import) and **4 manual/review rules** tracked honestly
- Backend-enforced approval gate; PR creation requires passing verification on the current commit

From the real demo run — **to be measured, do not quote before then**:

- Files changed, steps automatically / manually completed, steps left open → from the report
- Wall-clock time → measured by the report (target: ≤ 7 minutes)
- Manual-effort figure → always say "estimated"
- Bobcoin usage → only if read from Bob's UI during the run; the report does not measure it

---

## Bob Features to Call Out On-Screen

1. **Skill auto-activation** — no slash command, just natural language
2. **PDF document understanding** — migration guide attached directly in chat
3. **Parallel subagents** — two breadcrumbs at the same time
4. **Plan mode** — badge changes in the UI header
5. **Todo list** — checklist items ticking in real time
6. **Iterative verify loop** — Bob self-corrects without user input
7. **HTML artifact** — shareable one-pager with productivity metrics

---

## Recording Checklist

- [ ] Screen resolution ≥ 1920×1080
- [ ] Bob IDE in light mode (better contrast for recording)
- [ ] Font size bumped to 15px in Bob settings
- [ ] Terminal hidden (PAT must not appear on screen)
- [ ] Microphone tested; no background noise
- [ ] Demo repo prepared per `docs/target-repo.md` (fork exists, baseline green, no prior migration branch)
- [ ] MCP server running and connected before recording starts
