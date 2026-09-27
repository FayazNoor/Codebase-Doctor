# End-to-end run — recorded evidence (2026-09-26)

Produced by [`backend/scripts/e2e-demo.mjs`](../../../backend/scripts/e2e-demo.mjs) with `--sandbox-pr` and the
text of the React 18 upgrade guide (`docs/How to Upgrade to React 18 – React.pdf`) as migration docs.

**What is real:** the MCP server was the built `backend/dist/index.js`, driven over stdio exactly as Bob drives
it. The repository was a fresh git copy of [`examples/react17-demo-app`](../../../examples/react17-demo-app/). The
run included a real `npm install` of React 18.3.1 and real `npm run lint` / `test` / `build` (ESLint, Jest, esbuild).

**What was stood in for:**
- The script typed "approved" and made the manual edits Bob would make in the IDE. Every such action appears in
  the transcript as `👤 demo script (in place of Bob / the user)`.
- The pull request went to a local sandbox: a mocked GitHub REST API plus a local bare repository receiving the
  push. Nothing was sent to github.com.

Local absolute paths were replaced with `<workspace>` / `~`.

| File | Content |
|---|---|
| `transcript.md` / `transcript.json` | Every MCP call (68) with arguments, result text, timing, and each scripted human action |
| `reports/01-analysed.html` … `07-final.html` | `generate_report` (HTML) snapshots at each stage of the main session — open them in a browser |
| `reports/08-step-failed.html` | Side session: the demo app pinned to a `react-redux` release whose peer range stops at React 17. The preflight flags it, the user skips the warning, and the real install fails (ERESOLVE, naming `react-redux`); it is rolled back and recorded as `failed` |
| `reports/10-step-retried.html` | Same session after `react-redux` was upgraded to the suggested release: the dependency step succeeds on attempt 2 |
| `reports/09-verification-untrusted.html` | Side session: a hand-written `checks-result.json` is rejected as untrusted |
| `report-markdown.md` | `generate_report` (Markdown) after verification |
| `pull-request-body.md` | The PR body the tool sent (sandbox) |

Outcome of the main session: 8 applicable rules (3 automated, 5 manual/review). One peer conflict was caught before
install (`@testing-library/react@12` → ^14.3.1). Verification #1 **failed**: ESLint `react/no-deprecated` flagged
`unmountComponentAtNode`, and one test depended on an intermediate render that React 18 batches away. Verification
#2 **passed** after the recorded manual fixes. 9 files changed on the migration branch, and the PR opened (sandbox); a
retry returned the same PR.
