# Video Notes

## Demo Video Structure (target: 7 minutes)

See [`docs/DEMO_SCRIPT.md`](../docs/DEMO_SCRIPT.md) for the full script with exact narration.

---

## Timestamp Guide

| Time | Section | Key visual |
|---|---|---|
| 0:00 – 0:30 | Opening | Bob IDE, Agent mode active, empty chat |
| 0:30 – 1:30 | Kickoff | Skill auto-activates; PDF attachment; MCP tool calls begin |
| 1:30 – 2:30 | Parallel subagents | Two subagent breadcrumbs visible simultaneously |
| 2:30 – 3:30 | Blast radius + Plan mode | Plan mode badge; migration plan markdown in chat |
| 3:30 – 5:00 | Implementation | Todo list ticking off; high-risk file subagent breadcrumb |
| 5:00 – 6:00 | Verify loop | Failed verify → subagent diagnosis → passing verify |
| 6:00 – 7:00 | Report + PR | HTML artifact with metrics; live GitHub PR URL |

---

## Measurable Results to Highlight

- **~37 files changed** in the demo migration
- **7 breaking changes** from React 18 applied correctly
- **~7 minutes** wall-clock vs. **~18 hours** manual estimate
- **14 unit tests** passing (shown via `npm test` output)
- **10 MCP tools** registered and callable independently

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
- [ ] Demo repo fork fresh (no prior migration branch)
- [ ] MCP server running and connected before recording starts
