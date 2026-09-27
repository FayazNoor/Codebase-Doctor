# Problem & Solution

## Problem

Major dependency upgrades get put off. A bot can open the version bump, but someone still has to find every place
the package is used, work out which breaking changes apply to this codebase, change the code, fix the tests, run
lint, tests and build, and explain it all in a pull request. When nobody knows what will break, the upgrade waits
until it becomes urgent: a security fix or a compatibility deadline.

## Solution

**Codebase Doctor** is an IBM Bob 2.0 skill and MCP server that upgrades a dependency across a whole codebase, and
proves it works before you merge. In Bob you say "Upgrade react to 18.3.1 in [your repo]". Then it:

1. **Analyses** the whole package family (react, react-dom and their subpaths) with an AST scan: every import and
   API call, with file and line, plus a peer-dependency preflight.
2. **Keeps only the breaking changes that apply** to this repository (12 React 17 → 18 rules from the official
   guide; your migration docs can confirm each one).
3. **Ranks files by risk**, from concrete API evidence.
4. **Writes an ordered plan, and waits.** Nothing changes until you type "approved". The server enforces it: the
   branch, patch and pull-request tools refuse to run without an approval bound to the plan's content hash.
5. **Applies one commit per step**: codemods where they are safe, judgement calls left to you and clearly marked.
   A failed step is rolled back.
6. **Verifies with the repository's own** lint, test and build scripts against the newly installed versions, and
   keeps every run in the history.
7. **Opens a pull request only after the checks pass** on the pushed commit, with the full report as its
   description.

Session state is HMAC-sealed, so a hand-edited "passed" result shows up as untrusted instead of being believed.

## Proof: one recorded run (26 Sep 2026)

A React 17 demo app, driven over stdio exactly as Bob drives it, with a real npm install and real ESLint, Jest and
esbuild runs:

- 11 files use react; 9 need attention; 4 are high-risk
- 8 breaking changes apply (3 automated, 5 manual or review); a 10-step plan, one commit per step
- a peer conflict caught before install (`@testing-library/react` 12 → ^14.3.1)
- verification #1 **failed** (a deprecated `unmountComponentAtNode` call, and a test that React 18 batches
  differently); #2 passed after the fixes
- the pull request opened in a local GitHub sandbox (a mock API and a bare repository), not on github.com

A script stood in for the human: it typed "approved" and made the manual edits. Every number above is real tool
output, and the report labels anything that is estimated.

**Try it:** https://codebase-doctor-bob2.vercel.app (the 2-minute demo, and a step-by-step replay of the run)
**Code:** https://github.com/FayazNoor/Codebase-Doctor (241 automated tests)

**Limits today:** pull requests were verified against a sandbox only; React 17 → 18 is the golden path (Express
4 → 5 rules are review-only); single-package repositories.
