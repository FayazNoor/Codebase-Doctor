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
cd codebase-doctor/mcp-server
npm install && npm run build

# 2. Register the MCP server in Bob IDE
#    Add to your .bob/settings.json:
#    {
#      "mcpServers": {
#        "codebase-doctor": {
#          "command": "node",
#          "args": ["<absolute-path>/mcp-server/dist/index.js"],
#          "env": { "GITHUB_TOKEN": "<your-pat>" }
#        }
#      }
#    }

# 3. Set your GitHub token
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
codebase-doctor/
├── docs/
│   └── IMPLEMENTATION_PLAN.md   ← full architecture and design
├── mcp-server/                  ← MCP server (TypeScript/Node.js)
│   ├── src/
│   │   ├── index.ts             ← server entry + tool registration
│   │   ├── tools/               ← one file per MCP tool
│   │   ├── lib/                 ← git, AST, GitHub, session, risk helpers
│   │   └── knowledge/           ← seeded migration knowledge base
│   └── test/
│       ├── fixtures/            ← minimal React 17 app for integration tests
│       └── unit/                ← unit tests (Vitest)
├── .bob/
│   ├── skills/migration-doctor/ ← Bob skill (SKILL.md + supporting files)
│   └── rules/AGENTS.md          ← Bob rules for this repo
└── demo/                        ← demo script and target repo notes
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
# Build
npm run build

# Test (unit)
npm test

# Test (integration — requires git + network)
npm run test:integration --workspace=mcp-server

# Lint
npm run lint
```

---

## License

MIT
