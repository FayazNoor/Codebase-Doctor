# Codebase Doctor 🩺

> AI-Assisted Dependency Upgrade Doctor powered by **IBM Bob 2.0**  
> Built for the [lablab.ai IBM Bob 2.0 Hackathon](https://lablab.ai)

Codebase Doctor takes a GitHub repository, a dependency, and a target version — then autonomously analyses every usage, identifies applicable breaking changes, calculates blast radius, produces an approvable migration plan, implements the changes, verifies with lint/test/build, and opens a pull request.

---

## How It Works

```
User provides:  repo URL + dependency + target version + (optional) migration docs PDF

Bob (via migration-doctor skill):
  1. Analyse dependency usages  →  analyze_dependency_usage MCP tool
  2. Load migration requirements →  load_migration_requirements MCP tool
  3. Calculate blast radius      →  calculate_migration_blast_radius MCP tool
  4. Generate migration plan     →  generate_migration_plan MCP tool  [user approves]
  5. Implement changes           →  apply_migration_patch × N
  6. Verify                      →  verify_migration MCP tool  [iterative loop]
  7. PR + report                 →  create_pull_request + generate_report
```

**Demo migration:** React 17 → 18 on [`gothinkster/react-redux-realworld-example-app`](https://github.com/gothinkster/react-redux-realworld-example-app)

---

## Quick Start

### Prerequisites

- Node.js ≥ 20
- IBM Bob IDE with Bob 2.0
- GitHub Personal Access Token with `repo` scope

### Setup

```bash
# 1. Clone and install
git clone https://github.com/FayazNoor/Codebase-Doctor
cd Codebase-Doctor/backend
npm install && npm run build

# 2. Register the MCP server in Bob IDE
#    Add to your .bob/settings.json:
#    {
#      "mcpServers": {
#        "codebase-doctor": {
#          "command": "node",
#          "args": ["<absolute-path>/backend/dist/index.js"],
#          "env": { "GITHUB_TOKEN": "<your-pat>" }
#        }
#      }
#    }

# 3. Copy .env.example and set your GitHub token
cp .env.example .env
# Edit .env and replace GITHUB_TOKEN value
export GITHUB_TOKEN=ghp_...
```

### Run

Open Bob IDE, start a new Agent mode conversation, and say:

```
Upgrade react from 17 to 18 in https://github.com/gothinkster/react-redux-realworld-example-app
Here are the React 18 migration docs: [attach PDF or leave blank to use built-in knowledge]
```

The `migration-doctor` skill auto-activates and drives the full workflow.

---

## Repository Structure

```
Codebase-Doctor/
├── README.md
├── .gitignore
├── .env.example
│
├── frontend/                    ← placeholder (Bob IDE is the UI for MVP)
│   └── README.md
│
├── backend/                     ← MCP server (TypeScript/Node.js ESM)
│   ├── src/
│   │   ├── index.ts             ← server entry + tool registration
│   │   ├── tools/               ← one file per MCP tool (10 tools)
│   │   ├── lib/                 ← git, AST, GitHub, session, risk helpers
│   │   └── knowledge/           ← seeded migration knowledge base (JSON)
│   └── test/
│       ├── fixtures/            ← minimal React 17 app for tests
│       └── unit/                ← Vitest unit tests (14 tests)
│
├── .bob/
│   ├── skills/migration-doctor/ ← custom Bob skill (SKILL.md + supporting files)
│   └── rules/AGENTS.md          ← Bob rules for this repo
│
├── docs/
│   ├── PROBLEM_SOLUTION.md
│   ├── BOB_USAGE.md
│   ├── ARCHITECTURE.md
│   ├── DEMO_SCRIPT.md
│   └── bob-evidence/
│       ├── fayaz/               ← Bob session screenshots + usage log
│       │   ├── BOB_USAGE_LOG.md
│       │   └── *.png
│       └── teammate/            ← teammate Bob session screenshots + usage log
│           ├── BOB_USAGE_LOG.md
│           └── *.png
│
└── submission/
    ├── problem-solution.md
    ├── bob-statement.md
    └── video-notes.md
```

---

## Bob Features Demonstrated

| Feature | Where |
|---|---|
| Agent mode | Implementation, checks loop, PR creation |
| Plan mode | Migration plan generation + user approval gate |
| Parallel subagents | Analysis phase: repo + docs analysed concurrently |
| Background subagents | Per-file-cluster deep reads during implementation |
| Document understanding | User attaches migration guide PDF |
| Custom skill | `migration-doctor` auto-activates on upgrade intent |
| MCP server | All backend logic exposed as reusable MCP tools |
| HTML artifact | Before/after migration report |
| Todo list | Live progress during implementation phase |

---

## Development

```bash
# from repo root — or cd backend/ first
npm run build      # tsc → backend/dist/
npm test           # vitest unit tests (14 tests)
npm run typecheck  # type-check without emitting
npm run lint       # eslint backend/src/
```

---

## License

MIT
