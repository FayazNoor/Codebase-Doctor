/**
 * Codebase Doctor MCP Server — entry point
 *
 * Registers all tools with the MCP SDK and starts the stdio server.
 * Tools are thin: they validate input, call lib/ helpers, and return
 * compact string summaries to keep the main Bob context lean.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { analyzeDependencyUsage } from "./tools/analyze-dependency-usage.js";
import { loadMigrationRequirements } from "./tools/load-migration-requirements.js";
import { calculateMigrationBlastRadius } from "./tools/calculate-migration-blast-radius.js";
import { generateMigrationPlan } from "./tools/generate-migration-plan.js";
import { verifyMigration } from "./tools/verify-migration.js";
import { checkoutBranch } from "./tools/checkout-branch.js";
import { applyMigrationPatch } from "./tools/apply-migration-patch.js";
import { runChecks } from "./tools/run-checks.js";
import { createPullRequest } from "./tools/create-pull-request.js";
import { generateReport } from "./tools/generate-report.js";

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "codebase-doctor",
  version: "0.1.0",
});

// ---------------------------------------------------------------------------
// Tool: analyze_dependency_usage
// ---------------------------------------------------------------------------

server.tool(
  "analyze_dependency_usage",
  "Clone a GitHub repository and perform AST-level analysis to find every usage of a dependency. " +
    "Returns a sessionId and compact usage summary. Must be called first in every migration workflow.",
  {
    url: z.string().url().describe("GitHub repository URL (HTTPS)"),
    dependency: z.string().describe("Dependency name as it appears in package.json, e.g. 'react'"),
    targetVersion: z.string().describe("Target version to upgrade to, e.g. '18.3.1'"),
  },
  async ({ url, dependency, targetVersion }) => {
    const result = await analyzeDependencyUsage({ url, dependency, targetVersion });
    return { content: [{ type: "text", text: result }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: load_migration_requirements
// ---------------------------------------------------------------------------

server.tool(
  "load_migration_requirements",
  "Load and parse migration requirements for the upgrade. Uses the provided migration " +
    "documentation text (from an attached PDF or URL) and/or the built-in knowledge base. " +
    "Returns a structured list of breaking changes applicable to this repository.",
  {
    sessionId: z.string().uuid().describe("Session ID returned by analyze_dependency_usage"),
    docsText: z
      .string()
      .optional()
      .describe(
        "Full text of migration documentation (e.g. extracted from an attached PDF). " +
          "If omitted, the built-in knowledge base is used."
      ),
  },
  async ({ sessionId, docsText }) => {
    const result = await loadMigrationRequirements({ sessionId, docsText });
    return { content: [{ type: "text", text: result }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: calculate_migration_blast_radius
// ---------------------------------------------------------------------------

server.tool(
  "calculate_migration_blast_radius",
  "Calculate the blast radius of the migration: how many files are affected, " +
    "their risk distribution (high/medium/low), and the top affected files ranked by risk score. " +
    "Call after load_migration_requirements.",
  {
    sessionId: z.string().uuid().describe("Session ID"),
  },
  async ({ sessionId }) => {
    const result = await calculateMigrationBlastRadius({ sessionId });
    return { content: [{ type: "text", text: result }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: generate_migration_plan
// ---------------------------------------------------------------------------

server.tool(
  "generate_migration_plan",
  "Generate a prioritised, step-by-step migration plan based on the analysis and blast radius. " +
    "Writes migration-plan.json to the session directory and returns the plan as Markdown. " +
    "Present the plan to the user for approval before calling apply_migration_patch.",
  {
    sessionId: z.string().uuid().describe("Session ID"),
  },
  async ({ sessionId }) => {
    const result = await generateMigrationPlan({ sessionId });
    return { content: [{ type: "text", text: result }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: verify_migration
// ---------------------------------------------------------------------------

server.tool(
  "verify_migration",
  "Run lint, test, and build commands in the cloned repository and return a structured " +
    "pass/fail result with a failure diagnosis suitable for a subagent fix loop. " +
    "This is the skill-facing wrapper over run_checks.",
  {
    sessionId: z.string().uuid().describe("Session ID"),
  },
  async ({ sessionId }) => {
    const result = await verifyMigration({ sessionId });
    return { content: [{ type: "text", text: result }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: checkout_branch
// ---------------------------------------------------------------------------

server.tool(
  "checkout_branch",
  "Create and check out a new migration branch in the cloned repository. " +
    "Branch name: codebase-doctor/{dependency}-{targetVersion}-upgrade. " +
    "Idempotent: safe to call again if the branch already exists.",
  {
    sessionId: z.string().uuid().describe("Session ID"),
  },
  async ({ sessionId }) => {
    const result = await checkoutBranch({ sessionId });
    return { content: [{ type: "text", text: result }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: apply_migration_patch
// ---------------------------------------------------------------------------

server.tool(
  "apply_migration_patch",
  "Apply a single migration step to the repository: make the targeted code changes " +
    "described by the step, then commit them to the migration branch. " +
    "Returns a diff of the changes made.",
  {
    sessionId: z.string().uuid().describe("Session ID"),
    stepId: z.string().describe("Migration step ID from migration-plan.json"),
  },
  async ({ sessionId, stepId }) => {
    const result = await applyMigrationPatch({ sessionId, stepId });
    return { content: [{ type: "text", text: result }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: run_checks (internal — verify_migration is the skill-facing wrapper)
// ---------------------------------------------------------------------------

server.tool(
  "run_checks",
  "Run lint, test, and build commands and return raw structured output. " +
    "Use verify_migration for the skill workflow; use run_checks directly only for " +
    "low-level debugging.",
  {
    sessionId: z.string().uuid().describe("Session ID"),
    command: z
      .enum(["lint", "test", "build", "all"])
      .default("all")
      .describe("Which check to run"),
  },
  async ({ sessionId, command }) => {
    const result = await runChecks({ sessionId, command });
    return { content: [{ type: "text", text: result }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: create_pull_request
// ---------------------------------------------------------------------------

server.tool(
  "create_pull_request",
  "Push the migration branch to GitHub and open a pull request against the default branch. " +
    "The PR body includes the full migration report. Returns the PR URL.",
  {
    sessionId: z.string().uuid().describe("Session ID"),
  },
  async ({ sessionId }) => {
    const result = await createPullRequest({ sessionId });
    return { content: [{ type: "text", text: result }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: generate_report
// ---------------------------------------------------------------------------

server.tool(
  "generate_report",
  "Generate a before/after migration report as Markdown (and optionally HTML). " +
    "Includes blast radius stats, breaking changes addressed, test results, " +
    "and productivity metrics (wall-clock time, Bobcoin cost estimate).",
  {
    sessionId: z.string().uuid().describe("Session ID"),
    format: z
      .enum(["markdown", "html"])
      .default("markdown")
      .describe("Output format"),
  },
  async ({ sessionId, format }) => {
    const result = await generateReport({ sessionId, format });
    return { content: [{ type: "text", text: result }] };
  }
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server runs until stdin closes — no console.log to avoid polluting stdio
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
