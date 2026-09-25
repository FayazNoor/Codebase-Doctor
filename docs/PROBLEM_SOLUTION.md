# Problem & Solution

## Problem

Upgrading a major dependency in an unfamiliar repository is one of the most
painful, error-prone engineering tasks. A developer must:

- **Manually understand** where the dependency is used across the entire codebase
- **Read migration documentation** and identify which breaking changes apply
- **Estimate blast radius** — how many files will need to change, and how risky?
- **Modify code** across potentially dozens of files
- **Create or update regression tests** for changed behaviour
- **Run lint / test / build**, diagnose failures, and iterate
- **Write a clear PR description** explaining what changed and why

For a large codebase, this easily consumes **1–3 days** of senior engineering time, and is
frequently deferred until it becomes an urgent security or compatibility issue.

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
| 1 | Clones the repo and performs AST-level analysis to find **every usage** of the dependency |
| 2 | Reads and understands migration documentation (user-supplied PDF or built-in knowledge base) |
| 3 | Identifies only the breaking changes **applicable to this specific repo** |
| 4 | Calculates blast radius — files ranked by migration risk score |
| 5 | Produces a prioritised migration plan and presents it for **user approval** |
| 6 | Implements changes on a dedicated branch, file by file |
| 7 | Generates or updates tests |
| 8 | Runs lint / test / build, diagnoses failures, and iterates (max 3 loops) |
| 9 | Runs a final automated code review |
| 10 | Opens a pull request with a complete before/after migration report |

---

## Measurable Productivity Impact

The migration report generated at the end of each session includes:

- **Wall-clock time** from session start to PR opened
- **Manual estimate**: affected files × 30 min/file
- **Time saved**: manual estimate − actual time
- **Accuracy**: steps applied correctly / total steps

### Demo numbers (React 17 → 18, `react-redux-realworld-example-app`)

| Metric | Value |
|---|---|
| Files affected | ~37 |
| Manual estimate | ~18 hours |
| Codebase Doctor time | ~7 minutes |
| Time saved | ~17 hours 53 minutes |

---

## Why IBM Bob 2.0?

Bob 2.0's unique combination of **Agent mode**, **Plan mode**, **parallel subagents**,
**document understanding**, and **custom skills** makes this workflow possible in a single
coherent tool — no glue scripts, no context switching between tools.

See [`BOB_USAGE.md`](BOB_USAGE.md) for the detailed breakdown of every Bob feature used.
