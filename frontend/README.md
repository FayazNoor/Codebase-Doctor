# Frontend

> **Status: out of scope for the hackathon — post-hackathon future work.**
> The Bob IDE is the user-facing interface for Codebase Doctor. Nothing in this directory is
> required for the MVP or the demo; it only records the planned web UI.

---

## Planned UI (post-hackathon)

A React + Vite web app that wraps the same MCP tools behind a browser-based interface:

| Component | Purpose |
|---|---|
| `MigrationWizard` | 4-step form: repo URL → dependency → version → optional PDF |
| `BlastRadiusChart` | D3 treemap of files coloured by risk score |
| `MigrationPlanReview` | Approval gate — shows ordered steps before implementation starts |
| `ProgressDashboard` | Live todo list during implementation (SSE stream from backend) |
| `MigrationReport` | Before/after report with productivity metrics |

---

## Integration Points (when built)

- **Backend:** `POST /api/session/start` → wraps `analyze_dependency_usage` + `load_migration_requirements`
- **Backend:** `POST /api/session/:id/approve` → wraps `approve_migration_plan`
- **Backend:** `GET /api/session/:id/progress` → SSE stream of `apply_migration_patch` events
- **Backend:** `GET /api/session/:id/report` → final report JSON

---

## For the Hackathon Demo

Use Bob IDE directly. Open Agent mode and run:

```
Upgrade react from 17 to 18.3.1 in <prepared demo repo URL>
```

The demo repository still needs preparation — see [`docs/target-repo.md`](../docs/target-repo.md).

See [`docs/DEMO_SCRIPT.md`](../docs/DEMO_SCRIPT.md) for the full demo walkthrough.
