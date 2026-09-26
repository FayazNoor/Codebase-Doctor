# AGENTS.md — Agent Mode Rules

## MCP tool call order (enforce strictly)

```
analyze_dependency_usage       → sessionId (new session per call)
load_migration_requirements    → requires sessionId (+ optional docsText)
calculate_migration_blast_radius → requires sessionId + requirements
generate_migration_plan        → requires sessionId + blast radius → planId
[user types "approved"]
approve_migration_plan         → requires sessionId + planId + confirmation "approved"
checkout_branch                → requires recorded approval
apply_migration_patch          → requires approval + stepId (every step, in plan order;
                                 manual steps: again with markManualComplete + note once done)
verify_migration               → requires sessionId (loop max 3×)
generate_report                → requires sessionId
create_pull_request            → requires approval + latest verify_migration PASSED on HEAD
```

## Subagent guidance

- Spawn `explore` subagents for ALL file reads — never read source files in main context.
- Return ≤500 chars per subagent summary back to main context.
- Parallel subagents: extracting text from an attached migration document can run
  concurrently with `analyze_dependency_usage`; `load_migration_requirements` needs
  the resulting sessionId, so it runs after both.
- Per-file-cluster subagents in Step 5: max 3 in parallel for high-risk files only.

## Mode switches

- Switch to **Plan mode** before calling `generate_migration_plan` and rendering the plan.
- Switch back to **Agent mode** after user types "approved".
- Never switch modes mid-implementation.

## Error recovery

- If a tool throws, read the error message — it always contains a suggested next step.
- Never call `approve_migration_plan` unless the user replied "approved" to the current plan.
- Never report a `manual_required` step as done; only `applied` / `completed_manual` / `not_applicable` count.
- If the dependency step fails on a peer-dependency conflict, package.json is restored; tell the user which library conflicts.
- If `verify_migration` fails after 3 iterations, surface the `failureSummary` to the user and ask whether to continue manually.
- If `create_pull_request` refuses, it names the missing precondition (approval, passing verification on HEAD, un-run steps). It is safe to retry; an existing PR is returned instead of a duplicate.
