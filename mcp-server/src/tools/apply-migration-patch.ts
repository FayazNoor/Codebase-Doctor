/**
 * Tool: apply_migration_patch
 *
 * Applies a single migration step: makes the targeted code changes for the
 * given stepId, then commits them to the migration branch.
 * Returns a compact diff summary.
 */

import fs from "node:fs";
import path from "node:path";
import {
  assertSession,
  readPlan,
  writePlan,
  readAnalysis,
} from "../lib/session.js";
import { stageAndCommit, diffStat } from "../lib/git.js";
import type { MigrationStep } from "../types.js";

interface Input {
  sessionId: string;
  stepId: string;
}

export async function applyMigrationPatch(input: Input): Promise<string> {
  const { sessionId, stepId } = input;

  const session = assertSession(sessionId);
  const plan = readPlan(sessionId);
  const analysis = readAnalysis(sessionId);

  const step = plan.steps.find((s) => s.id === stepId);
  if (!step) {
    throw new Error(
      `Step '${stepId}' not found in migration plan. ` +
        `Available step IDs: ${plan.steps.map((s) => s.id).join(", ")}`
    );
  }

  if (step.applied) {
    return `ℹ️ Step '${step.title}' was already applied. Skipping.`;
  }

  const { localPath } = session.repo;

  // Apply the change
  await applyStep(step, session.upgrade.dependency, session.upgrade.toVersion, localPath, analysis.packageManager);

  // Commit
  const commitMsg = `chore(migration): ${step.title} [codebase-doctor step ${step.order}]`;
  stageAndCommit(localPath, commitMsg);

  // Get compact diff stat
  const stat = diffStat(localPath);

  // Mark as applied in plan
  step.applied = true;
  writePlan(sessionId, plan);

  return [
    `✅ Applied: ${step.title}`,
    `Type: ${step.changeType} | Files: ${step.files.length}`,
    ``,
    stat || "(no diff — files may have been already up to date)",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Step application logic
// ---------------------------------------------------------------------------

async function applyStep(
  step: MigrationStep,
  dependency: string,
  targetVersion: string,
  localPath: string,
  packageManager: string
): Promise<void> {
  switch (step.changeType) {
    case "config":
      applyConfigStep(step, dependency, targetVersion, localPath);
      break;
    case "codemod":
    case "manual":
      // For Phase 1 MVP: apply straightforward text-level transforms
      // More complex transforms are implemented per breaking-change ID
      applyCodeStep(step, localPath);
      break;
    case "test":
      // Test steps: no automated changes; Bob handles these via subagent
      break;
  }
}

function applyConfigStep(
  step: MigrationStep,
  dependency: string,
  targetVersion: string,
  localPath: string
): void {
  if (!step.files.includes("package.json")) return;

  const pkgPath = path.join(localPath, "package.json");
  if (!fs.existsSync(pkgPath)) return;

  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as Record<
    string,
    Record<string, string>
  >;

  if (pkg["dependencies"]?.[dependency]) {
    pkg["dependencies"][dependency] = `^${targetVersion}`;
  }
  if (pkg["devDependencies"]?.[dependency]) {
    pkg["devDependencies"][dependency] = `^${targetVersion}`;
  }

  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
}

function applyCodeStep(step: MigrationStep, localPath: string): void {
  // React 17→18 specific transforms (the MVP breaking changes)
  const transforms: Record<string, (content: string) => string> = {
    // ReactDOM.render → createRoot
    "react-bc-1": (c) =>
      c.replace(
        /import ReactDOM from ['"]react-dom['"]/g,
        "import { createRoot } from 'react-dom/client'"
      ).replace(
        /ReactDOM\.render\((<[^,]+>),\s*([^)]+)\)/g,
        "createRoot($2).render($1)"
      ),
    // ReactDOM.hydrate → hydrateRoot
    "react-bc-2": (c) =>
      c.replace(
        /ReactDOM\.hydrate\((<[^,]+>),\s*([^)]+)\)/g,
        "import { hydrateRoot } from 'react-dom/client';\nhydrateRoot($2, $1)"
      ),
  };

  const transform = step.breakingChangeId ? transforms[step.breakingChangeId] : null;
  if (!transform) return;

  for (const relFile of step.files) {
    const absFile = path.join(localPath, relFile);
    if (!fs.existsSync(absFile)) continue;
    const original = fs.readFileSync(absFile, "utf8");
    const transformed = transform(original);
    if (transformed !== original) {
      fs.writeFileSync(absFile, transformed, "utf8");
    }
  }
}
