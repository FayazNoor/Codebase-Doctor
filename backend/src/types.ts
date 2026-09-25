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

export interface Session {
  id: string;
  createdAt: string;
  repo: RepoInfo;
  upgrade: UpgradeInfo;
  migrationBranch: string;
  phase: SessionPhase;
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

export interface DependencyUsage {
  file: string;
  line: number;
  column: number;
  importSpecifier: string;
  usageContext: string;
  riskScore: number;
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

export interface BreakingChange {
  id: string;
  description: string;
  affectedApis: string[];
  affectedFiles: string[];
  automatable: boolean;
  codemods: string[];
  severity: "high" | "medium" | "low";
}

export interface MigrationRequirements {
  dependency: string;
  fromVersion: string;
  toVersion: string;
  breakingChanges: BreakingChange[];
  summary: string;
}

// ---------------------------------------------------------------------------
// Migration plan
// ---------------------------------------------------------------------------

export type ChangeType = "codemod" | "manual" | "config" | "test";

export interface MigrationStep {
  id: string;
  order: number;
  title: string;
  description: string;
  files: string[];
  changeType: ChangeType;
  breakingChangeId: string | null;
  automatable: boolean;
  approved: boolean;
  applied: boolean;
}

export interface MigrationPlan {
  sessionId: string;
  createdAt: string;
  summary: string;
  estimatedEffort: "low" | "medium" | "high";
  breakingChanges: BreakingChange[];
  steps: MigrationStep[];
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

export interface CheckResult {
  passed: boolean;
  output: string;
}

export interface ChecksResult {
  iteration: number;
  timestamp: string;
  lint: CheckResult;
  test: CheckResult & { failedTests: string[] };
  build: CheckResult;
  allPassed: boolean;
  failureSummary: string | null;
}
