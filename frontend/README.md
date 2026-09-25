# Frontend

> **MVP status:** The Bob IDE is the user-facing interface for Codebase Doctor.  
> This directory is a placeholder for a future web UI.

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
- **Backend:** `POST /api/session/:id/approve` → triggers implementation phase
- **Backend:** `GET /api/session/:id/progress` → SSE stream of `apply_migration_patch` events
- **Backend:** `GET /api/session/:id/report` → final report JSON

---

## For the Hackathon Demo

Use Bob IDE directly. Open Agent mode and run:

```
Upgrade react from 17 to 18 in https://github.com/FayazNoor/react-redux-realworld-example-app
```

See [`docs/DEMO_SCRIPT.md`](../docs/DEMO_SCRIPT.md) for the full demo walkthrough.
