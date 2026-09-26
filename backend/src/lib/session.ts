/**
 * Session state — read/write JSON files in <home>/sessions/<id>/
 * (<home> = $CODEBASE_DOCTOR_HOME, default ~/.codebase-doctor).
 *
 * All session data lives on disk so it survives Bob context resets.
 * Every tool reads session state at entry and writes it on exit.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import type {
  Session,
  SessionPhase,
  AnalysisResult,
  MigrationRequirements,
  MigrationPlan,
  ChecksResult,
} from "../types.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** Root for sessions and clones. Evaluated per call so tests can override it. */
export function doctorHome(): string {
  return process.env["CODEBASE_DOCTOR_HOME"] || path.join(os.homedir(), ".codebase-doctor");
}

export function sessionDir(sessionId: string): string {
  return path.join(doctorHome(), "sessions", sessionId);
}

function sessionFile(sessionId: string): string {
  return path.join(sessionDir(sessionId), "session.json");
}

function analysisFile(sessionId: string): string {
  return path.join(sessionDir(sessionId), "analysis.json");
}

function requirementsFile(sessionId: string): string {
  return path.join(sessionDir(sessionId), "requirements.json");
}

function planFile(sessionId: string): string {
  return path.join(sessionDir(sessionId), "migration-plan.json");
}

function checksFile(sessionId: string): string {
  return path.join(sessionDir(sessionId), "checks-result.json");
}

// ---------------------------------------------------------------------------
// Generic read / write
// ---------------------------------------------------------------------------

function readJson<T>(filePath: string): T {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw) as T;
}

function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

// ---------------------------------------------------------------------------
// Session CRUD
// ---------------------------------------------------------------------------

export function createSession(partial: Omit<Session, "id" | "createdAt" | "phase">): Session {
  const session: Session = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    phase: "analyzing",
    ...partial,
  };
  writeJson(sessionFile(session.id), session);
  return session;
}

export function readSession(sessionId: string): Session {
  return readJson<Session>(sessionFile(sessionId));
}

export function updateSession(sessionId: string, patch: Partial<Session>): Session {
  const current = readSession(sessionId);
  const updated = { ...current, ...patch };
  writeJson(sessionFile(sessionId), updated);
  return updated;
}

export function setPhase(sessionId: string, phase: SessionPhase): void {
  updateSession(sessionId, { phase });
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

export function writeAnalysis(sessionId: string, data: AnalysisResult): void {
  writeJson(analysisFile(sessionId), data);
}

export function readAnalysis(sessionId: string): AnalysisResult {
  return readJson<AnalysisResult>(analysisFile(sessionId));
}

// ---------------------------------------------------------------------------
// Requirements
// ---------------------------------------------------------------------------

export function writeRequirements(sessionId: string, data: MigrationRequirements): void {
  writeJson(requirementsFile(sessionId), data);
}

export function readRequirements(sessionId: string): MigrationRequirements {
  try {
    return readJson<MigrationRequirements>(requirementsFile(sessionId));
  } catch {
    throw new Error(
      `No migration requirements for session '${sessionId}'. Call load_migration_requirements first.`
    );
  }
}

export function readRequirementsIfExists(sessionId: string): MigrationRequirements | null {
  return fs.existsSync(requirementsFile(sessionId))
    ? readJson<MigrationRequirements>(requirementsFile(sessionId))
    : null;
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export function writePlan(sessionId: string, data: MigrationPlan): void {
  writeJson(planFile(sessionId), data);
}

export function readPlan(sessionId: string): MigrationPlan {
  try {
    return readJson<MigrationPlan>(planFile(sessionId));
  } catch {
    throw new Error(
      `No migration plan for session '${sessionId}'. Call generate_migration_plan first.`
    );
  }
}

export function readPlanIfExists(sessionId: string): MigrationPlan | null {
  return fs.existsSync(planFile(sessionId)) ? readJson<MigrationPlan>(planFile(sessionId)) : null;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

export function writeChecks(sessionId: string, data: ChecksResult): void {
  writeJson(checksFile(sessionId), data);
}

export function readChecks(sessionId: string): ChecksResult {
  return readJson<ChecksResult>(checksFile(sessionId));
}

export function readChecksIfExists(sessionId: string): ChecksResult | null {
  return fs.existsSync(checksFile(sessionId)) ? readJson<ChecksResult>(checksFile(sessionId)) : null;
}

// ---------------------------------------------------------------------------
// Utility: assert session exists
// ---------------------------------------------------------------------------

/**
 * Approval gate: throws unless the CURRENT plan has a recorded approval.
 * Every source-changing tool (checkout_branch, apply_migration_patch,
 * create_pull_request) calls this before touching the repository.
 */
export function assertPlanApproved(sessionId: string): MigrationPlan {
  const plan = readPlan(sessionId);
  if (!plan.approval?.approved || plan.approval.planId !== plan.planId) {
    throw new Error(
      `Migration plan ${plan.planId} has not been approved. Present the plan to the user; ` +
        `after they type "approved", call approve_migration_plan with ` +
        `{ sessionId, planId: "${plan.planId}", confirmation: "approved" }.`
    );
  }
  return plan;
}

export function assertSession(sessionId: string): Session {
  try {
    return readSession(sessionId);
  } catch {
    throw new Error(
      `Session '${sessionId}' not found. Call analyze_dependency_usage first to create a session.`
    );
  }
}
