# How we used IBM Bob 2.0

Bob is both the runtime and the builder of Codebase Doctor.

## Bob as the runtime

- **Custom skill.** `migration-doctor` (`.bob/skills/migration-doctor/SKILL.md`) activates on upgrade intent and
  drives the whole workflow. One sentence in Bob starts it.
- **MCP server.** 12 tools in `backend/`, from `analyze_dependency_usage` to `create_pull_request`, plus
  `get_session_status` for recovery. Bob calls them over stdio, and each returns plain text Bob can reason about.
- **Plan mode.** The migration plan is presented in Plan mode. The user replies "approved" and Bob calls
  `approve_migration_plan`. The server enforces it: the tools that change code or push refuse to run without an
  approval matching the plan's content hash.
- **Agent mode.** Applies the plan step by step, runs verification and the fix loop (up to three iterations), and
  opens the pull request.
- **Todo list.** Each plan step becomes a todo item and ticks off as `apply_migration_patch` completes it. Manual
  items tick off only once the change is recorded.
- **Subagents.** Files with a risk score of 70 or more get a dedicated explore subagent before patching; a final
  code-review subagent uses `fork_context` to see the whole session.
- **Document understanding.** The user attaches the React 18 upgrade guide PDF in chat. Bob reads it and passes the
  text to `load_migration_requirements`, which checks the built-in rules against it.
- **HTML artifact.** `generate_report` returns a stage-aware HTML report that Bob renders with
  `create_html_artifact`: measured results, labelled estimates, and what is not measured (Bobcoins, accuracy).

## Bob as the builder

We built the server in Bob Agent mode sessions: the scaffold, the React 18 transforms, the integration tests (one
session ended at 61 of 61 tests passing) and a repository audit. Later sessions ran the migration workflow itself
in Bob, with the plan as a todo list, a high-risk subagent and tool approvals.

## Evidence (`docs/bob-evidence/`)

- `fayaz/`: `BOB_USAGE_LOG.md` and four session screenshots (the scaffold, a consistency audit, the React 18
  engine, the end-to-end integration tests).
- `uzair/`: `BOB_USAGE_LOG.md` and seven session screenshots (the React 17 → 18 migration, the plan and migration
  completed, the high-risk subagent, the todo list in progress, the folder structure, the go/no-go checklist).

**Scope, stated plainly:** those Bob sessions used earlier versions of the server. The final version was verified
with 241 automated tests, a recorded end-to-end run over stdio (the protocol Bob uses) and the official MCP
Inspector. A full Bob session with the final version has not been re-recorded.
