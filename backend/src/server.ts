/**
 * Codebase Doctor MCP server — tool registration.
 *
 * createServer() registers every tool with the MCP SDK; src/index.ts connects
 * it to stdio (tests connect it to an in-memory transport). Tools are thin:
 * they validate input, call lib/ helpers, and return compact string summaries
 * to keep the main Bob context lean. A thrown error becomes an MCP tool error
 * whose text is the error message (always phrased with a next step).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { analyzeDependencyUsage } from "./tools/analyze-dependency-usage.js";
import { loadMigrationRequirements } from "./tools/load-migration-requirements.js";
import { calculateMigrationBlastRadius } from "./tools/calculate-migration-blast-radius.js";
import { generateMigrationPlan } from "./tools/generate-migration-plan.js";
import { approveMigrationPlan } from "./tools/approve-migration-plan.js";
import { verifyMigration } from "./tools/verify-migration.js";
import { checkoutBranch } from "./tools/checkout-branch.js";
import { applyMigrationPatch } from "./tools/apply-migration-patch.js";
import { runChecks } from "./tools/run-checks.js";
import { createPullRequest } from "./tools/create-pull-request.js";
import { generateReport } from "./tools/generate-report.js";
import { getSessionStatus } from "./tools/get-session-status.js";

export const SERVER_VERSION = "0.2.0";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "codebase-doctor",
    version: SERVER_VERSION,
  });

  // ---------------------------------------------------------------------------
  // Tool: analyze_dependency_usage
  // ---------------------------------------------------------------------------

  server.tool(
    "analyze_dependency_usage",
    "Clone a repository (GitHub URL, or an absolute path to a local git repo — cloned, never modified) and perform " +
      "AST-level analysis of the dependency's package family (e.g. react + react-dom/client/test-utils/server): import " +
      "sites plus concrete API usages. Also checks declared packages for peer ranges that exclude the target version. " +
      "Public GitHub repos need no token. Creates a NEW session on every call and returns its sessionId. Must be called first.",
    {
      url: z
        .string()
        .min(1)
        .max(2048)
        .describe("GitHub repository URL (https://github.com/owner/repo or git@github.com:owner/repo.git) or an absolute local path"),
      dependency: z.string().min(1).max(214).describe("Dependency name as it appears in package.json, e.g. 'react'"),
      targetVersion: z.string().min(1).max(64).describe("Target version, e.g. '18.3.1', '18' or '^18.3.1' (no dist-tags like 'latest')"),
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
        .max(2_000_000)
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
      "Writes migration-plan.json (deterministic step IDs, content-hashed planId) and returns the plan as Markdown. " +
      "Re-calling with unchanged inputs returns the existing plan. Present the plan to the user; after they type " +
      "'approved', call approve_migration_plan.",
    {
      sessionId: z.string().uuid().describe("Session ID"),
    },
    async ({ sessionId }) => {
      const result = await generateMigrationPlan({ sessionId });
      return { content: [{ type: "text", text: result }] };
    }
  );

  // ---------------------------------------------------------------------------
  // Tool: approve_migration_plan
  // ---------------------------------------------------------------------------

  server.tool(
    "approve_migration_plan",
    "Record the user's approval of the current migration plan. Call ONLY after the user has replied 'approved' " +
      "to the presented plan. checkout_branch, apply_migration_patch and create_pull_request refuse to run until " +
      "this is recorded. Idempotent.",
    {
      sessionId: z.string().uuid().describe("Session ID"),
      planId: z.string().describe("planId shown in the generate_migration_plan output"),
      confirmation: z.string().describe("The user's literal reply — must be 'approved'"),
    },
    async ({ sessionId, planId, confirmation }) => {
      const result = await approveMigrationPlan({ sessionId, planId, confirmation });
      return { content: [{ type: "text", text: result }] };
    }
  );

  // ---------------------------------------------------------------------------
  // Tool: verify_migration
  // ---------------------------------------------------------------------------

  server.tool(
    "verify_migration",
    "Check that node_modules holds the upgraded packages, run lint, test, and build in the cloned repository, " +
      "persist the result (with the verified commit), and return PASS/FAIL/SKIPPED per check plus a failure " +
      "diagnosis suitable for a subagent fix loop. This is the skill-facing wrapper over run_checks.",
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
    "Create and check out the migration branch in the cloned repository " +
      "(codebase-doctor/{dependency}-{targetVersion}-upgrade). Requires an approved plan. " +
      "Idempotent: switches to the branch if it already exists.",
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
    "Execute one migration step on the migration branch (requires an approved plan). Dependency step: updates " +
      "package.json for the package family, runs the package manager install (lockfile updated) and verifies installed " +
      "versions. Codemod steps: run the known transform and re-scan for leftovers. Manual/test steps make no edits and " +
      "are reported as 'manual_required'; after the change is made, call again with markManualComplete:true and a note. " +
      "skip:true + note records that the user deliberately defers a step (still reported as open). A failure rolls the " +
      "step back and records 'failed'; call again to retry. Already-processed steps are skipped.",
    {
      sessionId: z.string().uuid().describe("Session ID"),
      stepId: z.string().describe("Migration step ID from migration-plan.json"),
      markManualComplete: z
        .boolean()
        .optional()
        .describe("Record that the manual change/review for this step is done (commits working-tree edits)"),
      skip: z
        .boolean()
        .optional()
        .describe("Record that the user deliberately defers this step (not allowed for the dependency step)"),
      note: z
        .string()
        .max(2000)
        .optional()
        .describe("Required with markManualComplete (what was changed or reviewed) or skip (why it is deferred)"),
    },
    async ({ sessionId, stepId, markManualComplete, skip, note }) => {
      const result = await applyMigrationPatch({ sessionId, stepId, markManualComplete, skip, note });
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
    "Push the migration branch to GitHub and open a pull request against the default branch (needs GITHUB_TOKEN). " +
      "Refuses unless the plan is approved, no step is pending or failed, and the latest verify_migration passed on the " +
      "current commit with a clean working tree. Idempotent: returns the existing PR instead of opening a duplicate. " +
      "The PR body includes the migration report.",
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
    "Generate the migration report as Markdown or HTML from persisted session data, at any stage: progress and next " +
      "action, real lint/test/build results, risk ranking, each breaking change with its actual step status, per-file " +
      "evidence, per-step diffs, peer-dependency conflicts, remaining work, measured metrics, clearly labelled estimates, " +
      "and metrics that are not measured (e.g. Bobcoin usage). Render the HTML with create_html_artifact.",
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
  // Tool: get_session_status
  // ---------------------------------------------------------------------------

  server.tool(
    "get_session_status",
    "Read-only recovery aid. Without sessionId: list recent sessions. With sessionId: phase, approval, each step's " +
      "status, latest verification, PR, and the single next action. Use it after a context reset or an interrupted run.",
    {
      sessionId: z.string().uuid().optional().describe("Session ID; omit to list recent sessions"),
    },
    async ({ sessionId }) => {
      const result = await getSessionStatus({ sessionId });
      return { content: [{ type: "text", text: result }] };
    }
  );

  return server;
}
