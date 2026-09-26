/**
 * Tool: apply_migration_patch
 *
 * Executes ONE migration step on the migration branch and records an honest
 * status (see StepStatus in types.ts):
 *
 *   config  → edit package.json for the package family, run the package
 *             manager install (lockfile updated), verify installed versions,
 *             commit package.json + lockfile                → applied
 *   codemod → run the known transform, commit changed files, re-scan for the
 *             breaking pattern                              → applied | manual_required
 *   manual  → no automated edits                            → manual_required
 *   test    → no automated edits                            → manual_required | not_applicable
 *
 * A manual/test step (or a codemod with residue) only becomes
 * `completed_manual` when called again with markManualComplete + note, after
 * the human/Bob edits are in the working tree. For "code" rules the tool
 * refuses if the breaking pattern is still present.
 *
 * Requires an approved plan and the migration branch to be checked out.
 */

import fs from "node:fs";
import path from "node:path";
import {
  assertSession,
  assertPlanApproved,
  writePlan,
  readAnalysis,
} from "../lib/session.js";
import { stageAndCommit, commitStat, currentBranch, restorePaths } from "../lib/git.js";
import { findDependencyUsages } from "../lib/ast.js";
import { matchBreakingChanges } from "../lib/risk.js";
import { resolveEcosystem, versionGte } from "../lib/ecosystem.js";
import {
  writePackageChanges,
  runInstall,
  checkInstalledVersions,
  readInstalledVersions,
  LOCKFILES,
  type PackageManager,
} from "../lib/packages.js";
import { REACT_TRANSFORMS } from "../lib/transforms.js";
import type { BreakingChange, MigrationPlan, MigrationStep, Session, StepOutcome, StepStatus } from "../types.js";

interface Input {
  sessionId: string;
  stepId: string;
  /** Record that a human/Bob completed (or reviewed) a manual step. */
  markManualComplete?: boolean;
  /** Required with markManualComplete: what was done. */
  note?: string;
}

interface StepResult {
  status: StepStatus;
  outcome: Omit<StepOutcome, "at">;
}

export async function applyMigrationPatch(input: Input): Promise<string> {
  const { sessionId, stepId } = input;

  const session = assertSession(sessionId);
  const plan = assertPlanApproved(sessionId);
  const analysis = readAnalysis(sessionId);

  const step = plan.steps.find((s) => s.id === stepId);
  if (!step) {
    throw new Error(
      `Step '${stepId}' not found in migration plan. ` +
        `Available step IDs: ${plan.steps.map((s) => s.id).join(", ")}`
    );
  }

  const { localPath } = session.repo;
  const branch = currentBranch(localPath);
  if (branch !== session.migrationBranch) {
    throw new Error(
      `Repository is on '${branch}', not the migration branch '${session.migrationBranch}'. Call checkout_branch first.`
    );
  }

  const bc = step.breakingChangeId ? plan.breakingChanges.find((b) => b.id === step.breakingChangeId) ?? null : null;

  let result: StepResult;
  if (input.markManualComplete) {
    result = completeManually(step, bc, session, input.note);
  } else {
    if (step.status !== "pending") {
      return [
        `ℹ️ Step '${step.title}' was already processed — status: ${step.status}. Skipping.`,
        step.outcome?.note ?? "",
        step.status === "manual_required"
          ? `When the manual change is done, call apply_migration_patch with markManualComplete: true and a note.`
          : "",
      ].filter(Boolean).join("\n");
    }
    switch (step.changeType) {
      case "config":
        result = applyDependencyStep(step, session, analysis.packageManager);
        break;
      case "codemod":
        result = applyCodemodStep(step, bc, session, plan);
        break;
      case "manual":
        result = {
          status: "manual_required",
          outcome: {
            commit: null,
            filesChanged: [],
            note: `No automated change exists for this rule. ${bc?.manualAction ?? "Apply it manually."}`,
          },
        };
        break;
      case "test":
        result =
          step.files.length === 0
            ? {
                status: "not_applicable",
                outcome: { commit: null, filesChanged: [], note: "No test files use the dependency; the suite is still run by verify_migration." },
              }
            : {
                status: "manual_required",
                outcome: {
                  commit: null,
                  filesChanged: [],
                  note: "No automated test changes are made. Update tests if needed, run verify_migration, then record with markManualComplete.",
                },
              };
        break;
    }
  }

  step.status = result.status;
  step.outcome = { at: new Date().toISOString(), ...result.outcome };
  writePlan(sessionId, plan);

  const stat = result.outcome.commit ? commitStat(localPath, result.outcome.commit) : "(no commit — no source changes)";
  const icon = { applied: "✅", completed_manual: "✍️", manual_required: "⚠️", not_applicable: "➖", pending: "⏳" }[step.status];
  return [
    `${icon} ${step.title}`,
    `Status: ${step.status} | Type: ${step.changeType}`,
    step.outcome.note,
    ...(step.outcome.residual?.length ? [`Remaining: ${step.outcome.residual.slice(0, 5).join("; ")}`] : []),
    ``,
    stat,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// config: dependency family update + install
// ---------------------------------------------------------------------------

function applyDependencyStep(step: MigrationStep, session: Session, pm: PackageManager): StepResult {
  const { localPath } = session.repo;
  const { dependency, toVersion } = session.upgrade;
  const changes = step.packageChanges ?? [];

  if (changes.length === 0) {
    return {
      status: "not_applicable",
      outcome: { commit: null, filesChanged: [], note: "package.json already declares the target versions." },
    };
  }

  const lockfile = LOCKFILES[pm];
  const touched = ["package.json", lockfile];
  writePackageChanges(localPath, changes);

  const install = runInstall(localPath, pm);
  if (!install.ok) {
    restorePaths(localPath, touched);
    throw new Error(
      `\`${install.command}\` failed, so package.json${install.lockfile ? ` and ${install.lockfile}` : ""} were restored and the step stays pending.\n` +
        tail(install.output, 12) +
        `\nLikely cause: a dependency whose peer range excludes ${dependency} ${toVersion} (e.g. an old testing library). ` +
        `Upgrade that package manually on the migration branch, commit, and re-run this step.`
    );
  }

  const check = checkInstalledVersions(localPath, dependency, toVersion);
  if (!check.ok) {
    restorePaths(localPath, touched);
    throw new Error(
      `Install finished but node_modules does not hold the upgraded packages: ${check.problems.join("; ")}. ` +
        `package.json was restored; the step stays pending.`
    );
  }

  const commit = stageAndCommit(localPath, commitMessage(step), touched);
  const installed = Object.fromEntries(Object.entries(check.installed).filter((e): e is [string, string] => e[1] !== null));
  return {
    status: "applied",
    outcome: {
      commit: commit.sha,
      filesChanged: commit.files,
      note: `Ran \`${install.command}\`; installed ${Object.entries(installed).map(([n, v]) => `${n}@${v}`).join(", ")}.`,
      installedVersions: installed,
    },
  };
}

// ---------------------------------------------------------------------------
// codemod: known transform + residual evidence check
// ---------------------------------------------------------------------------

function applyCodemodStep(step: MigrationStep, bc: BreakingChange | null, session: Session, plan: MigrationPlan): StepResult {
  const { localPath } = session.repo;
  const transform = step.breakingChangeId ? REACT_TRANSFORMS[step.breakingChangeId] : undefined;

  if (!bc || !transform) {
    // Defensive: the plan only marks canonical rules with a transform as codemod.
    return {
      status: "manual_required",
      outcome: { commit: null, filesChanged: [], note: "No known automated transform for this rule; apply it manually." },
    };
  }
  if (step.files.length === 0) {
    return { status: "not_applicable", outcome: { commit: null, filesChanged: [], note: "No files use the affected API." } };
  }

  if (bc.minTargetVersion) {
    const depStep = plan.steps.find((s) => s.changeType === "config");
    if (depStep && depStep.status === "pending") {
      throw new Error(`Apply the dependency step '${depStep.id}' first: this transform needs the new version installed.`);
    }
    const pkg = resolveEcosystem(session.upgrade.dependency).packages[0];
    const installed = readInstalledVersions(localPath, [pkg])[pkg];
    if (!installed || !versionGte(installed, bc.minTargetVersion)) {
      return {
        status: "manual_required",
        outcome: {
          commit: null,
          filesChanged: [],
          note: `Not transformed: requires ${pkg} ≥ ${bc.minTargetVersion} installed (found ${installed ?? "none"}). ${bc.manualAction ?? ""}`.trim(),
        },
      };
    }
  }

  const changed: string[] = [];
  for (const relFile of step.files) {
    const absFile = path.join(localPath, relFile);
    if (!fs.existsSync(absFile)) continue;
    const original = fs.readFileSync(absFile, "utf8");
    const transformed = transform(original);
    if (transformed !== original) {
      fs.writeFileSync(absFile, transformed, "utf8");
      changed.push(relFile);
    }
  }

  const commit = changed.length > 0 ? stageAndCommit(localPath, commitMessage(step), changed) : null;
  const residual = findResidual(step, bc, session);

  if (residual.length === 0) {
    return changed.length > 0
      ? { status: "applied", outcome: { commit: commit?.sha ?? null, filesChanged: changed, note: `Transformed ${changed.length} file(s); no remaining usages of the old API.` } }
      : { status: "not_applicable", outcome: { commit: null, filesChanged: [], note: "No remaining usages found (already migrated)." } };
  }
  return {
    status: "manual_required",
    outcome: {
      commit: commit?.sha ?? null,
      filesChanged: changed,
      residual,
      note:
        `Transformed ${changed.length} file(s); ${residual.length} usage(s) could not be migrated safely and need manual changes. ` +
        (bc.manualAction ?? ""),
    },
  };
}

// ---------------------------------------------------------------------------
// Manual completion
// ---------------------------------------------------------------------------

function completeManually(step: MigrationStep, bc: BreakingChange | null, session: Session, note?: string): StepResult {
  if (step.status === "completed_manual") {
    return { status: step.status, outcome: step.outcome ?? { commit: null, filesChanged: [], note: "Already completed." } };
  }
  if (step.changeType === "config") {
    throw new Error("The dependency step cannot be marked complete manually; run it without markManualComplete so install + version checks happen.");
  }
  if (step.status === "pending" && step.changeType === "codemod") {
    throw new Error("Run the automated step first (call apply_migration_patch without markManualComplete).");
  }
  if (step.status === "applied" || step.status === "not_applicable") {
    throw new Error(`Step is already '${step.status}'; nothing to complete manually.`);
  }
  if (!note || note.trim().length < 5) {
    throw new Error("markManualComplete requires a `note` describing what was changed or reviewed.");
  }

  // "code" rules: the breaking pattern must be gone from the working tree.
  if (bc && (bc.resolution ?? "code") === "code") {
    const residual = findResidual(step, bc, session);
    if (residual.length > 0) {
      throw new Error(`Still found ${residual.length} usage(s): ${residual.slice(0, 5).join("; ")}. Fix them, then retry.`);
    }
  }

  const commit = stageAndCommit(session.repo.localPath, commitMessage(step));
  return {
    status: "completed_manual",
    outcome: {
      commit: commit.sha,
      filesChanged: commit.files,
      note: `Completed manually: ${note.trim()}`,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Re-scan the step's files for usages that are still evidence of `bc`. */
function findResidual(step: MigrationStep, bc: BreakingChange, session: Session): string[] {
  const eco = resolveEcosystem(session.upgrade.dependency);
  const usages = findDependencyUsages({ repoPath: session.repo.localPath, dependency: eco.packages, files: step.files });
  return usages
    .filter((u) => matchBreakingChanges(u, [bc]).length > 0)
    .map((u) => `${u.file}:${u.line} ${u.importSpecifier}`);
}

function commitMessage(step: MigrationStep): string {
  const title = step.title.length > 90 ? `${step.title.slice(0, 87)}...` : step.title;
  return `chore(migration): ${title} [codebase-doctor step ${step.order}]`;
}

function tail(text: string, lines: number): string {
  return text.trim().split("\n").slice(-lines).join("\n");
}
