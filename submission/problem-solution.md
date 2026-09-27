# Problem & Solution

## Problem

Upgrading a major dependency in an unfamiliar repository is one of the most painful, error-prone engineering tasks. A developer must:

- **Manually understand** where the dependency is used across the entire codebase
- **Read migration documentation** and identify which breaking changes apply
- **Estimate blast radius** — how many files will need to change, and how risky?
- **Modify code** across potentially dozens of files
- **Create or update regression tests** for changed behaviour
- **Run lint / test / build**, diagnose failures, and iterate
- **Write a clear PR description** explaining what changed and why

For a large codebase, this easily consumes **1–3 days** of senior engineering time, and is frequently deferred until it becomes an urgent security or compatibility issue.

---

## Solution: Codebase Doctor

**Codebase Doctor** is an AI-assisted dependency upgrade tool powered by IBM Bob 2.0.

A developer provides:
1. A GitHub repository URL
2. A dependency name (e.g. `react`)
3. A target version (e.g. `18.3.1`)
4. Optionally: migration documentation (PDF or URL)

Codebase Doctor then autonomously:

| Step | What happens |
|---|---|
| 1 | Clones the repo and performs AST-level analysis of the dependency's **package family** (for React: `react`, `react-dom`, `react-dom/client`, `react-dom/test-utils`) — import sites **and** concrete API calls such as `ReactDOM.render(...)` |
| 2 | Uses its built-in migration rules, validated and augmented by user-supplied documentation (e.g. a PDF) |
| 3 | Identifies only the breaking changes with **evidence in this specific repo** |
| 4 | Calculates blast radius — files ranked by migration risk score |
| 5 | Produces a prioritised migration plan; **nothing is changed until the user approves** (enforced by the backend) |
| 6 | Upgrades the package family together (e.g. `react` + `react-dom`), runs the real install and updates the lockfile |
| 7 | Applies automated transforms where they are safe; tracks manual items (including test updates) until a human/Bob completes them |
| 8 | Verifies installed versions and runs lint / test / build, diagnoses failures, and iterates (max 3 loops) |
| 9 | Runs a final automated code review (Bob subagent) |
| 10 | Opens a pull request — only after verification passes — with a report that separates automatic fixes, manual fixes, and open items |

---

## Measurable Productivity Impact

The migration report generated at the end of each session separates:

- **Measured:** lint / test / build results, installed versions, files changed on the branch,
  steps fixed automatically vs. manually vs. still open, elapsed session time
- **Estimated (labelled as such):** manual effort = affected files × 30 min (a heuristic, not a
  benchmark) and estimated time saved = that estimate − measured elapsed time
- **Not measured:** Bobcoin consumption and accuracy — the server cannot observe them, so the
  report says "not measured" instead of inventing numbers

### Demo numbers — measured on the demo app (script-driven run, not a live Bob run)

Recorded on 2026-09-26 by `backend/scripts/e2e-demo.mjs`: the real MCP server over stdio, driving
`examples/react17-demo-app`. The install, lint, test and build were real; the PR went to a local sandbox, not
github.com. Full transcript and report snapshots: `docs/evidence/e2e-run/`. A live Bob run has not been recorded
with this version.

| Metric | Value | Kind |
|---|---|---|
| Files using react / react-dom | 11 of 13 source files | measured |
| Files with breaking-change evidence | 9 (4 high-risk) | measured |
| Breaking changes applied to this repo | 8 (3 automated, 5 manual/review) | measured |
| Peer conflicts caught before install | 1 (`@testing-library/react@12`, upgraded to ^14.3.1) | measured |
| Verification | #1 failed (lint + 1 test), #2 passed after the recorded manual fixes | measured |
| Files changed on the migration branch | 9 | measured |
| Wall-clock for the whole workflow | 400 s in the recorded run, which shared the machine with other workloads (139–400 s across runs; dominated by `npm install`) | measured — script-driven, excludes human/Bob thinking time |
| Manual effort | ~4.5 h (9 affected files × 30 min) | estimate only |
| Time saved | estimate only (manual-effort estimate − measured elapsed time) | estimate only |
| Bobcoin usage, accuracy | not measured | — |

---

## Why IBM Bob 2.0?

Bob 2.0's unique combination of **Agent mode**, **Plan mode**, **parallel subagents**, **document understanding**, and **custom skills** makes this workflow possible in a single coherent tool — no glue scripts, no context switching between tools.

See [`BOB_USAGE.md`](../docs/BOB_USAGE.md) for the detailed breakdown of every Bob feature used.
