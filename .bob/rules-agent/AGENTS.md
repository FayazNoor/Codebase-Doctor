# AGENTS.md — Agent Mode Rules

## MCP tool call order (enforce strictly)

```
analyze_dependency_usage       → sessionId
load_migration_requirements    → requires sessionId
calculate_migration_blast_radius → requires sessionId + requirements
generate_migration_plan        → requires sessionId + blast radius
[user approval]
checkout_branch                → requires sessionId
apply_migration_patch          → requires sessionId + stepId (repeat per step)
verify_migration               → requires sessionId (loop max 3×)
generate_report                → requires sessionId
create_pull_request            → requires sessionId
```

## Subagent guidance

- Spawn `explore` subagents for ALL file reads — never read source files in main context.
- Return ≤500 chars per subagent summary back to main context.
- Parallel subagents: Steps 1+2 (analyze + load requirements) can run concurrently.
- Per-file-cluster subagents in Step 5: max 3 in parallel for high-risk files only.

## Mode switches

- Switch to **Plan mode** before calling `generate_migration_plan` and rendering the plan.
- Switch back to **Agent mode** after user types "approved".
- Never switch modes mid-implementation.

## Error recovery

- If a tool throws, read the error message — it always contains a suggested next step.
- If `verify_migration` fails after 3 iterations, surface the `failureSummary` to the user and ask whether to continue manually.
- If `create_pull_request` fails with 422, the branch may not have been pushed — call `checkout_branch` again (idempotent) then retry.
