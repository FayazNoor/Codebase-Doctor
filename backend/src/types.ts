/**
 * Shared data model types for Codebase Doctor.
 * These are used by MCP tools, lib helpers, and tests.
 */

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export type SessionPhase =
  | "analyzing"
  | "plan_ready"
  | "plan_approved"
  | "implementing"
  | "checks_running"
  | "checks_passed"
  | "pr_open"
  | "complete";

export interface RepoInfo {
  url: string;
  owner: string;
  name: string;
  localPath: string;
  defaultBranch: string;
}

export interface UpgradeInfo {
  dependency: string;
  fromVersion: string;
  toVersion: string;
}

export interface PullRequestInfo {
  url: string;
  number: number;
  createdAt: string;
}

export interface Session {
  id: string;
  createdAt: string;
  repo: RepoInfo;
  upgrade: UpgradeInfo;
  migrationBranch: string;
  phase: SessionPhase;
  /** Commit the migration branch was created from (set by checkout_branch). */
  baseCommit?: string;
  /** Pull request opened for this session (set by create_pull_request). */
  pullRequest?: PullRequestInfo;
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

export interface DependencyUsage {
  file: string;
  line: number;
  column: number;
  /**
   * "import" — an import/require site of a package in the dependency family.
   * "api"    — a concrete use of an imported API: a call (`ReactDOM.render(...)`),
   *            member access / JSX tag (`<React.StrictMode>`), or a named import
   *            binding (`import { act } from 'react-dom/test-utils'`).
   */
  kind: "import" | "api";
  /** Exact module specifier the binding came from, e.g. "react-dom/test-utils". */
  module: string;
  /** Exported API name for kind "api" (e.g. "render", "act"); null for imports. */
  api: string | null;
  /** Argument count when the usage is a call expression; otherwise null. */
  argCount: number | null;
  /** Import clause for imports ("React, { useState }"); qualified name for APIs ("ReactDOM.render"). */
  importSpecifier: string;
  /** Source line of the usage (trimmed, ≤120 chars). */
  usageContext: string;
  /** File-level risk score (0–100) assigned by calculate_migration_blast_radius. */
  riskScore: number;
  /** Breaking changes this concrete usage is evidence for. */
  breakingChangeIds: string[];
}

export interface BlastRadiusReport {
  totalFiles: number;
  affectedFiles: number;
  riskDistribution: { high: number; medium: number; low: number };
  topAffectedFiles: Array<{ file: string; riskScore: number; reason: string }>;
}

export interface AnalysisResult {
  repoLanguage: "typescript" | "javascript" | "mixed";
  packageManager: "npm" | "yarn" | "pnpm";
  testFramework: string | null;
  buildCommand: string | null;
  lintCommand: string | null;
  testCommand: string | null;
  dependencyUsages: DependencyUsage[];
  blastRadius: BlastRadiusReport | null;
}

// ---------------------------------------------------------------------------
// Migration requirements
// ---------------------------------------------------------------------------

/**
 * Machine-readable evidence pattern: a breaking change applies to a file when
 * the file uses `api` imported from exactly `module`.
 */
export interface DetectPattern {
  module: string;
  api: string;
  /** Only match call sites with at least this many arguments. */
  minArgs?: number;
}

export interface BreakingChange {
  id: string;
  description: string;
  /** Human-readable API names (also the fallback matcher when `detect` is absent). */
  affectedApis: string[];
  affectedFiles: string[];
  automatable: boolean;
  codemods: string[];
  severity: "high" | "medium" | "low";
  /** Guidance shown in the migration plan for manual-only breaking changes. */
  manualAction?: string;
  /** Concrete source patterns that are evidence for this breaking change. */
  detect?: DetectPattern[];
  /**
   * How completion is judged:
   *  "code"   — the detected pattern must disappear from source (default).
   *  "review" — a human audit; the pattern legitimately stays (e.g. useState).
   */
  resolution?: "code" | "review";
  /** Automated transform needs at least this installed version of the primary package. */
  minTargetVersion?: string;
  /** Phrases used to recognise this rule in user-supplied migration docs. */
  docsKeywords?: string[];
  /** Where the rule came from. Canonical rules keep their knowledge-base IDs. */
  source?: "knowledge-base" | "docs";
  /** True/false when docs were supplied and did / did not mention this rule; absent otherwise. */
  docsConfirmed?: boolean;
}

export interface MigrationRequirements {
  dependency: string;
  fromVersion: string;
  toVersion: string;
  breakingChanges: BreakingChange[];
  summary: string;
  /** Knowledge-base file used (null when none applies). */
  knowledgeBase: string | null;
  /** Whether user-supplied docs text was used to validate/augment the rules. */
  docsSupplied: boolean;
  /** Coverage caveats, e.g. "repo is on 16.x; rules cover 17 → 18". */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Migration plan
// ---------------------------------------------------------------------------

export type ChangeType = "codemod" | "manual" | "config" | "test";

/**
 * Honest step lifecycle:
 *  pending          — not executed yet
 *  applied          — the tool changed code/config and verified no evidence remains
 *  manual_required  — needs human action (manual step, or automation left residue)
 *  completed_manual — a human/Bob made (or reviewed) the change and recorded it
 *  not_applicable   — nothing to do for this repository
 */
export type StepStatus =
  | "pending"
  | "applied"
  | "manual_required"
  | "completed_manual"
  | "not_applicable";

export interface PackageChange {
  name: string;
  section: "dependencies" | "devDependencies";
  from: string;
  to: string;
}

export interface StepOutcome {
  /** When the status last changed. */
  at: string;
  /** Commit created for this step, or null if nothing was committed. */
  commit: string | null;
  /** Files actually modified by this step. */
  filesChanged: string[];
  /** Why the step has its current status. */
  note: string;
  /** Evidence still present after automation, as "file:line api". */
  residual?: string[];
  /** Installed versions read from node_modules after the dependency step. */
  installedVersions?: Record<string, string>;
}

export interface MigrationStep {
  /** Deterministic ID, stable across plan regeneration (e.g. "step-2-react-bc-1"). */
  id: string;
  order: number;
  title: string;
  description: string;
  files: string[];
  changeType: ChangeType;
  breakingChangeId: string | null;
  automatable: boolean;
  status: StepStatus;
  /** Planned package.json edits (config step only). */
  packageChanges?: PackageChange[];
  outcome?: StepOutcome;
}

export interface PlanApproval {
  approved: boolean;
  approvedAt: string | null;
  /** The planId that was approved; approval is void if the plan changes. */
  planId: string | null;
  /** The user's confirmation text as passed to approve_migration_plan. */
  confirmation: string | null;
}

export interface MigrationPlan {
  sessionId: string;
  /** Content hash of the plan — changes whenever steps/files change. */
  planId: string;
  /** Hash of the inputs (requirements + scored usages) the plan was built from. */
  inputFingerprint: string;
  createdAt: string;
  summary: string;
  estimatedEffort: "low" | "medium" | "high";
  breakingChanges: BreakingChange[];
  steps: MigrationStep[];
  approval: PlanApproval;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

export type CheckStatus = "passed" | "failed" | "skipped";

export interface CheckResult {
  status: CheckStatus;
  /** Command that ran, or null when skipped (no script detected / not requested). */
  command: string | null;
  output: string;
}

export interface DependencyCheck {
  status: CheckStatus;
  /** Installed versions read from node_modules for the synced package family. */
  installed: Record<string, string | null>;
  output: string;
}

export interface ChecksResult {
  iteration: number;
  timestamp: string;
  /** git HEAD the checks ran against (null if not a git repo). */
  headCommit: string | null;
  /** Installed dependency versions match the upgrade target. */
  dependencies: DependencyCheck;
  lint: CheckResult;
  test: CheckResult & { failedTests: string[] };
  build: CheckResult;
  /**
   * True only when no check failed, the dependency check passed, and at least
   * one of lint/test/build actually ran (all-skipped verifies nothing).
   */
  allPassed: boolean;
  failureSummary: string | null;
}
