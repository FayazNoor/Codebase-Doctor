# Bob Evidence — Uzair

Screenshots of IBM Bob 2.0 sessions run by Uzair while building and dry-running Codebase Doctor (2026-09-26),
plus a usage log ([`BOB_USAGE_LOG.md`](BOB_USAGE_LOG.md)). These are real Bob IDE captures. They show an
**earlier version** of the server (11 tools, 141 tests) and a dry run on `gothinkster/react-redux-realworld-example-app`.

## Screenshot Index

Checked 2026-09-26. Each file was matched to its content.

| File | What the screenshot shows |
|---|---|
| `03-react17-to-react18-migration.png` | Bob Agent mode: integration check of the cloned repo — install/build/lint/test PASS matrix (141/141 tests), MCP server registration via `.bob/mcp.json`, skill/approval-gate review |
| `04-plan-and-migration-completed.png` | Bob Agent mode with the React 18 guide PDF attached: analysis results (session, 26 imports / 13 API usages, 2 breaking changes), blast radius, plan `3ca955de7fab`, recorded approval, branch created |
| `05-todo-list-in-progress.png` | Bob todo list for the implementation phase; Bob reports that the MCP server was not connected in that session and continues with file-system tools |
| `05-high-risk-sub-agent.png` | Bob running `npm install --legacy-peer-deps` directly and editing `src/index.js`, then an automatic-batching review across 11 component files (tool-approval prompt visible) |
| `05-migration-completed.png` | Bob's dry-run summary: 2 files changed, react-bc-1 applied, react-bc-4 reviewed |
| `06-complete-folder-structure.png` | Bob's final summary including the "reconstructed" `checks-result.json` (see the correction note in the log) |
| `07-checklist-for-live-demo.png` | Bob's GO / NO-GO checklist for the live demo. **A GitHub token that was visible in row 13 was redacted on 2026-09-26**; the original image is still in git history, so the token must be revoked |

> The dry run shown in 04–06 did **not** go through the tools' gates: Bob installed with `--legacy-peer-deps`,
> edited files directly and wrote session state by hand. The correction note at the end of the log explains what
> this means for the numbers in those screenshots, and how the server now prevents it.

> **How to capture:** take a screenshot right after each significant Bob interaction and name it
> `NN-short-description.png`. Add a row above only after the file exists, and check that no token or other secret
> is visible before committing.
