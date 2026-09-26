# Codebase Doctor 🩺

> AI-Assisted Dependency Upgrade Doctor powered by **IBM Bob 2.0**
> Built for the [lablab.ai IBM Bob 2.0 Hackathon](https://lablab.ai)

Codebase Doctor takes a GitHub repository, a dependency, and a target version — then analyses how the
dependency's package family is used (import sites **and** concrete API calls), identifies the breaking
changes that apply to *this* repo, calculates blast radius, produces a migration plan that must be
approved, implements the automatable changes, verifies with lint/test/build against the newly installed
versions, and opens a pull request whose report distinguishes what was fixed automatically, what was done
manually, and what still needs a human.

---

## How It Works

```
User provides:  repo URL + dependency + target version + (optional) migration docs PDF

Bob (via migration-doctor skill):
  1. Analyse dependency usages   →  analyze_dependency_usage
  2. Load migration requirements →  load_migration_requirements   (built-in rules, validated/augmented by docs)
  3. Calculate blast radius      →  calculate_migration_blast_radius
  4. Generate migration plan     →  generate_migration_plan        [Plan mode]
     User types "approved"       →  approve_migration_plan         (backend-enforced gate)
  5. Implement changes           →  checkout_branch + apply_migration_patch × N
  6. Verify                      →  verify_migration               [iterative loop, max 3]
  7. Report + PR                 →  generate_report + create_pull_request (requires passing verification)
```

**Golden-path migration:** React 17 → 18 (`react` + `react-dom`, including `react-dom/client` and
`react-dom/test-utils`). Express 4 → 5 rules exist but are manual-only.

**Demo target:** [`gothinkster/react-redux-realworld-example-app`](https://github.com/gothinkster/react-redux-realworld-example-app)
— ⚠️ **not demo-ready yet**, see [`docs/target-repo.md`](docs/target-repo.md) (it is on React 16.3 and its
`react-redux@5` peer range blocks installing React 18; the fork has not been created).

---

## Quick Start

### Prerequisites

- Node.js ≥ 20 and git
- IBM Bob IDE with Bob 2.0
- GitHub Personal Access Token with `repo` scope

### Setup

```bash
# 1. Clone and build (npm workspaces — install from the repo root)
git clone https://github.com/FayazNoor/Codebase-Doctor
cd Codebase-Doctor
npm install
npm run build            # → backend/dist/index.js

# 2. Register the MCP server in Bob IDE (project-level config)
cp .bob/mcp.example.json .bob/mcp.json
#    Edit .bob/mcp.json: set the absolute path to backend/dist/index.js and your GITHUB_TOKEN.
#    .bob/mcp.json is gitignored — never commit it.
#    (Alternatively add the same server entry in Bob's global MCP settings via the MCP tab.)
```

The server reads its configuration **only from environment variables** (it does not load `.env` files).
[`.env.example`](.env.example) documents them: `GITHUB_TOKEN` (required), `CODEBASE_DOCTOR_HOME`
(state directory, default `~/.codebase-doctor`) and `CODEBASE_DOCTOR_PROJECT_URL` (optional).

### Run

Open Bob IDE, start a new Agent mode conversation, and say:

```
Upgrade react from 17 to 18.3.1 in https://github.com/<owner>/<react-17-repo>
Here are the React 18 migration docs: [attach PDF or leave blank to use built-in knowledge]
```

The `migration-doctor` skill auto-activates and drives the workflow; it stops for your "approved"
before any code is changed.

---

## Current Status

| Area | Status |
|---|---|
| MCP server — 11 tools | ✅ Implemented; typecheck, lint and build clean |
| Tests | ✅ 141 passing (126 unit + 15 integration), no network needed |
| React family analysis (react, react-dom, subpaths) with API-level evidence | ✅ |
| Automated transforms: `ReactDOM.render` → `createRoot`, `ReactDOM.hydrate` → `hydrateRoot`, `act` import | ✅ |
| Manual rules tracked honestly (`manual_required` / `completed_manual`) | ✅ |
| Dependency step: react + react-dom synced, real install, lockfile, installed-version check | ✅ (install mocked in tests) |
| Approval gate + verification-gated PR creation | ✅ |
| Real end-to-end run in Bob against a GitHub repo | ⏳ Not yet done — demo target needs preparation |
| Web frontend | Out of scope for the hackathon (Bob IDE is the UI) — see [`frontend/README.md`](frontend/README.md) |

---

## Repository Structure

```
Codebase-Doctor/
├── README.md · LICENSE · .env.example · package.json (npm workspaces)
│
├── frontend/                    ← post-hackathon placeholder (Bob IDE is the UI)
│
├── backend/                     ← MCP server (TypeScript/Node.js ESM)
│   ├── src/
│   │   ├── index.ts             ← server entry + tool registration (11 tools)
│   │   ├── tools/               ← one file per MCP tool
│   │   ├── lib/                 ← ast, ecosystem, risk, requirements, packages, transforms, git, github, session
│   │   └── knowledge/           ← breaking-change knowledge base (JSON)
│   └── test/
│       ├── fixtures/            ← minimal React 17 app
│       ├── unit/                ← Vitest unit tests
│       └── integration/         ← full pipeline on a disposable git copy (no network)
│
├── .bob/
│   ├── skills/migration-doctor/ ← custom Bob skill (SKILL.md + checklist + severity guide)
│   ├── rules/ · rules-agent/    ← Bob rules for this repo
│   └── mcp.example.json         ← MCP server config template (copy to .bob/mcp.json)
│
├── docs/                        ← architecture, Bob usage, demo script, evidence
└── submission/                  ← hackathon submission texts
```

---

## Bob Features Used

| Feature | Where |
|---|---|
| Agent mode | Implementation, checks loop, PR creation |
| Plan mode | Migration plan generation + user approval (recorded by `approve_migration_plan`) |
| Parallel subagents | Attached-docs extraction alongside repo analysis; up to 3 high-risk file reads |
| Document understanding | User attaches migration guide PDF |
| Custom skill | `migration-doctor` auto-activates on upgrade intent |
| MCP server | All backend logic exposed as reusable MCP tools |
| HTML artifact | Migration report |
| Todo list | Live progress during implementation |

---

## Development

```bash
# from the repo root (workspace scripts) — or run the same scripts inside backend/
npm run build             # tsc → backend/dist/
npm test                  # all tests (unit + integration)
npm run test:integration  # integration tests only
npm run typecheck         # type-check without emitting
npm run lint              # eslint backend/src
```

---

## License

[MIT](LICENSE)
