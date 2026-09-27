# Frontend

> **Status: intentionally not built.** Codebase Doctor is Bob-native: **IBM Bob IDE is the user interface.**

The product's visual surfaces are:

| Surface | Where it comes from |
|---|---|
| Conversation, plan approval, todo list, subagents | Bob IDE, driven by the `migration-doctor` skill (`.bob/skills/`) |
| **Migration report** — stage tracker, risk ranking, breaking changes, plan, per-file evidence, diffs, verification history, remaining work, metrics | `generate_report` (`format: "html"`), rendered by Bob with `create_html_artifact`; the same HTML opens in any browser (light/dark, responsive, accessible) |
| Pull request body | `generate_report` (`format: "markdown"`), posted by `create_pull_request` |

A separate web app would duplicate Bob's role, so it was deliberately left out. See
[`features-screen-shots/`](../features-screen-shots/README.md) for the report at every stage. The MCP server is
also exercised through the official MCP Inspector.

## If a web UI is built later

It should be a thin client over the same MCP server (for example over an HTTP/SSE MCP transport), and it must keep
the backend-enforced approval gate. Plausible screens:

| Screen | Backed by |
|---|---|
| Start a migration (repo, dependency, version, optional docs) | `analyze_dependency_usage`, `load_migration_requirements` |
| Plan review + approve | `generate_migration_plan`, `approve_migration_plan` |
| Progress | `get_session_status`, `apply_migration_patch` |
| Report | `generate_report` (the existing HTML) |
