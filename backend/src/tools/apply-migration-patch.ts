/**
 * Tool: apply_migration_patch
 *
 * Executes ONE migration step on the migration branch and records an honest
 * status (see StepStatus in types.ts):
 *
 *   config  → edit package.json for the package family, run the package
 *             manager install (lockfile updated), verify installed versions,
 *             commit package.json + lockfile                → applied | failed
 *   codemod → run the known transform, commit changed files, re-scan for the
 *             breaking pattern                              → applied | manual_required | failed
 *   manual  → no automated edits                            → manual_required
 *   test    → no automated edits                            → manual_required | not_applicable
 *
 * A manual/test step (or a codemod with residue) only becomes
 * `completed_manual` when called again with markManualComplete + note, after
 * the human/Bob edits are in the working tree. For "code" rules the tool
 * refuses if the breaking pattern is still present.
 *
 * `skip: true` + note records that the user deliberately deferred a step
 * (never the dependency step); it stays visible as open work in the report.
 *
 * Failures (install error, rejected commit) roll the step's files back, are
 * persisted as `failed` with the command output, and can be retried by
 * calling the tool again.
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
  diagnoseInstallFailure,
  LOCKFILES,
  type PackageManager,
} from "../lib/packages.js";
import { REACT_TRANSFORMS } from "../lib/transforms.js";
import { cleanOutput } from "../lib/output.js";
import { STEP_ICON } from "./generate-migration-plan.js";
import type { BreakingChange, MigrationPlan, MigrationStep, PeerConflict, Session, StepOutcome, StepStatus } from "../types.js";

interface Input {
  sessionId: string;
  stepId: string;
  /** Record that a human/Bob completed (or reviewed) a manual step. */
  markManualComplete?: boolean;
  /** Record that the user deliberately defers this step. */
  skip?: boolean;
  /** Required with markManualComplete / skip: what was done, or why it is skipped. */
  note?: string;
}

interface StepResult {
  status: StepStatus;
  outcome: Omit<StepOutcome, "at">;
}

/** Statuses from which the automated execution may (re)run. */
const RUNNABLE: StepStatus[] = ["pending", "failed", "skipped"];

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
  if (input.markManualComplete && input.skip) {
    throw new Error("Use either markManualComplete or skip, not both.");
  }

  const { localPath } = session.repo;
  const branch = currentBranch(localPath);
  if (branch !== session.migrationBranch) {
    throw new Error(
      `Repository is on '${branch}', not the migration branch '${session.migrationBranch}'. Call checkout_branch first.`
    );
  }

  const bc = step.breakingChangeId ? plan.breakingChanges.find((b) => b.id === step.breakingChangeId) ?? null : null;
  // Only executions count as attempts — recording a manual completion or a skip does not.
  const attempts = (step.outcome?.attempts ?? 0) + (input.markManualComplete || input.skip ? 0 : 1);

  let result: StepResult;
  let failure: StepFailure | null = null;
  if (input.markManualComplete) {
    result = completeManually(step, bc, session, input.note);
  } else if (input.skip) {
    result = skipStep(step, input.note);
  } else {
    if (!RUNNABLE.includes(step.status)) {
      return [
        `ℹ️ Step '${step.title}' was already processed — status: ${step.status}. Skipping.`,
        step.outcome?.note ?? "",
        step.status === "manual_required"
          ? `When the manual change is done, call apply_migration_patch with markManualComplete: true and a note (or skip: true with a reason).`
          : "",
      ].filter(Boolean).join("\n");
    }
    try {
      switch (step.changeType) {
        case "config":
          result = applyDependencyStep(step, session, analysis.packageManager, plan, analysis.compat?.conflicts);
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
              note: step.breakingChangeId
                ? `No automated change exists for this rule. ${bc?.manualAction ?? "Apply it manually."}`
                : "No automated change is made for this step. Follow the step description, then record it with markManualComplete.",
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
    } catch (err) {
      if (!(err instanceof StepFailure)) throw err;
      failure = err;
      result = { status: "failed", outcome: { commit: null, filesChanged: [], note: err.message, errorOutput: err.output } };
    }
  }

  step.status = result.status;
  step.outcome = { at: new Date().toISOString(), ...result.outcome, attempts };
  writePlan(sessionId, plan);

  if (failure) {
    throw new Error(
      `❌ Step ${step.order} FAILED (attempt ${attempts}) — recorded as 'failed'; its changes were rolled back.\n${failure.message}` +
        (failure.output ? `\n--- output (tail) ---\n${failure.output}` : "") +
        `\nFix the cause and call apply_migration_patch again to retry, or skip: true with a reason.`
    );
  }

  const stat = result.outcome.commit ? commitStat(localPath, result.outcome.commit) : "(no commit — no source changes)";
  const next = plan.steps.find((s) => s.status === "pending");
  return [
    `${STEP_ICON[step.status]} Step ${step.order}: ${step.title}`,
    `Status: ${step.status} | Type: ${step.changeType}${attempts > 1 ? ` | attempt ${attempts}` : ""}`,
    step.outcome.note,
    ...(step.outcome.residual?.length ? [`Remaining: ${step.outcome.residual.slice(0, 5).join("; ")}`] : []),
    ``,
    stat,
    ``,
    next ? `Next pending step: ${next.id}` : `All steps have run — next: verify_migration.`,
  ].join("\n");
}

/** A step-level failure that is recorded as status "failed" (not a tool/usage error). */
class StepFailure extends Error {
  constructor(message: string, readonly output?: string) {
    super(message);
    this.name = "StepFailure";
  }
}

// ---------------------------------------------------------------------------
// config: dependency family update + install
// ---------------------------------------------------------------------------

function applyDependencyStep(
  step: MigrationStep,
  session: Session,
  pm: PackageManager,
  plan: MigrationPlan,
  conflicts: PeerConflict[] | undefined
): StepResult {
  const { localPath } = session.repo;
  const { dependency, toVersion } = session.upgrade;
  const changes = step.packageChanges ?? [];

  const peerStep = plan.steps.find((s) => s.id.endsWith("-peer-compat"));
  if (peerStep && (peerStep.status === "pending" || peerStep.status === "manual_required" || peerStep.status === "failed")) {
    throw new Error(
      `Resolve the peer-dependency conflicts first (step '${peerStep.id}', status ${peerStep.status}): the install fails until they are fixed. ` +
        `Record it with markManualComplete, or skip: true with a reason if you believe the conflict is not real.`
    );
  }

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
    // npm often reports a peer conflict from the side of a package that was upgraded correctly
    // (e.g. "@testing-library/react@14 needs react ^18") while the real blocker is a library the
    // preflight already flagged and the user chose to skip. Say so.
    let preflightHint = "";
    if (peerStep?.status === "skipped" && /ERESOLVE|peer dep|unmet peer|Conflicting peer dependency|ERR_PNPM_PEER_DEP_ISSUES/i.test(install.output)) {
      const flagged = (conflicts ?? []).filter((c) => !c.autoUpgrade);
      if (flagged.length > 0) {
        preflightHint =
          ` The preflight flagged ${flagged.map((c) => `\`${c.name}@${c.version}\` (peer ${c.peer} ${c.range.split(" — ")[0]}${c.suggestion ? `; try \`${c.suggestion}\`` : ""})`).join(", ")}` +
          ` and step '${peerStep.id}' was skipped — that is the likely blocker even if npm names another package.`;
      }
    }
    throw new StepFailure(
      `\`${install.command}\` failed, so package.json${install.lockfile ? ` and ${install.lockfile}` : ""} were restored. ` +
        diagnoseInstallFailure(install.output, pm, dependency, toVersion) +
        preflightHint,
      tail(cleanOutput(install.output, localPath), 12)
    );
  }

  const check = checkInstalledVersions(localPath, dependency, toVersion);
  if (!check.ok) {
    restorePaths(localPath, touched);
    throw new StepFailure(
      `Install finished but node_modules does not hold the upgraded packages: ${check.problems.join("; ")}. package.json was restored.`
    );
  }

  let commit;
  try {
    commit = stageAndCommit(localPath, commitMessage(step), touched);
  } catch (err) {
    restorePaths(localPath, touched);
    throw new StepFailure(`The install succeeded but the commit was rejected: ${(err as Error).message}`);
  }
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
    if (depStep && (depStep.status === "pending" || depStep.status === "failed")) {
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

  let commit = null;
  if (changed.length > 0) {
    try {
      commit = stageAndCommit(localPath, commitMessage(step), changed);
    } catch (err) {
      // Never leave transformed-but-uncommitted files behind: a retry would
      // otherwise find "nothing to transform" and wrongly report success.
      restorePaths(localPath, changed);
      throw new StepFailure(`Transformed ${changed.length} file(s) but the commit was rejected, so they were restored: ${(err as Error).message}`);
    }
  }
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
// Manual completion / skip
// ---------------------------------------------------------------------------

function completeManually(step: MigrationStep, bc: BreakingChange | null, session: Session, note?: string): StepResult {
  if (step.status === "completed_manual") {
    return { status: step.status, outcome: step.outcome ?? { commit: null, filesChanged: [], note: "Already completed." } };
  }
  if (step.changeType === "config") {
    throw new Error("The dependency step cannot be marked complete manually; run it without markManualComplete so install + version checks happen.");
  }
  if ((step.status === "pending" || step.status === "failed") && step.changeType === "codemod") {
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

function skipStep(step: MigrationStep, note?: string): StepResult {
  if (step.changeType === "config") {
    throw new Error("The dependency step cannot be skipped — the migration depends on it. Fix the failure and retry it instead.");
  }
  if (step.status === "applied" || step.status === "completed_manual" || step.status === "not_applicable") {
    throw new Error(`Step is already '${step.status}'; there is nothing to skip.`);
  }
  if (!note || note.trim().length < 5) {
    throw new Error("skip requires a `note` explaining why the step is deferred (it is shown in the report and PR).");
  }
  return {
    status: "skipped",
    outcome: { commit: null, filesChanged: [], note: `Skipped by user: ${note.trim()}`, residual: step.outcome?.residual },
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
