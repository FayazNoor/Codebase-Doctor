/**
 * Session state — read/write JSON files in <home>/sessions/<id>/
 * (<home> = $CODEBASE_DOCTOR_HOME, default ~/.codebase-doctor).
 *
 * All session data lives on disk so it survives Bob context resets.
 * Every tool reads session state at entry and writes it on exit.
 *
 * Writes are atomic (temp file + rename) so an interrupted tool never leaves
 * half-written JSON, and every file is sealed (lib/integrity.ts) so state
 * edited outside the tools is detected instead of trusted.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { integrityKey, sealed, unseal } from "./integrity.js";
import type {
  Session,
  SessionPhase,
  AnalysisResult,
  MigrationRequirements,
  MigrationPlan,
  MigrationStep,
  ChecksResult,
  ChecksHistoryEntry,
} from "../types.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** Root for sessions and clones. Evaluated per call so tests can override it. */
export function doctorHome(): string {
  return process.env["CODEBASE_DOCTOR_HOME"] || path.join(os.homedir(), ".codebase-doctor");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sessionDir(sessionId: string): string {
  // Session IDs become path segments: never allow anything but a UUID.
  if (!UUID.test(sessionId)) throw new Error(`Invalid sessionId '${sessionId}': expected a UUID.`);
  return path.join(doctorHome(), "sessions", sessionId);
}

const FILES = {
  session: "session.json",
  analysis: "analysis.json",
  requirements: "requirements.json",
  plan: "migration-plan.json",
  checks: "checks-result.json",
  history: "checks-history.json",
} as const;

function file(sessionId: string, name: keyof typeof FILES): string {
  return path.join(sessionDir(sessionId), FILES[name]);
}

// ---------------------------------------------------------------------------
// Generic sealed read / write
// ---------------------------------------------------------------------------

function readJson<T>(filePath: string): T {
  const raw = fs.readFileSync(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${path.basename(filePath)} is not valid JSON (corrupted session state). Start a new session.`);
  }
  return unseal<T>(integrityKey(doctorHome()), filePath, parsed);
}

function writeJson(filePath: string, data: object): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const body = JSON.stringify(sealed(integrityKey(doctorHome()), data), null, 2) + "\n";
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, body, "utf8");
  fs.renameSync(tmp, filePath);
}

function isMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === "ENOENT";
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
  writeJson(file(session.id, "session"), session);
  return session;
}

export function readSession(sessionId: string): Session {
  return readJson<Session>(file(sessionId, "session"));
}

export function updateSession(sessionId: string, patch: Partial<Session>): Session {
  const current = readSession(sessionId);
  const updated = { ...current, ...patch };
  writeJson(file(sessionId, "session"), updated);
  return updated;
}

export function setPhase(sessionId: string, phase: SessionPhase): void {
  updateSession(sessionId, { phase });
}

/** Remove a session's state directory (used when analysis fails before completing). */
export function deleteSessionDir(sessionId: string): void {
  fs.rmSync(sessionDir(sessionId), { recursive: true, force: true });
}

export interface SessionSummary {
  id: string;
  createdAt: string;
  repo: string;
  upgrade: string;
  phase: SessionPhase | "unreadable";
}

/** Most recent sessions first (for recovery after a context reset). */
export function listSessions(limit = 10): SessionSummary[] {
  const root = path.join(doctorHome(), "sessions");
  if (!fs.existsSync(root)) return [];
  const out: SessionSummary[] = [];
  for (const id of fs.readdirSync(root)) {
    if (!UUID.test(id)) continue;
    try {
      const s = readSession(id);
      out.push({
        id,
        createdAt: s.createdAt,
        repo: s.repo.owner ? `${s.repo.owner}/${s.repo.name}` : s.repo.url,
        upgrade: `${s.upgrade.dependency} ${s.upgrade.fromVersion} → ${s.upgrade.toVersion}`,
        phase: s.phase,
      });
    } catch {
      const stat = fs.statSync(path.join(root, id));
      out.push({ id, createdAt: stat.mtime.toISOString(), repo: "?", upgrade: "?", phase: "unreadable" });
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

export function writeAnalysis(sessionId: string, data: AnalysisResult): void {
  writeJson(file(sessionId, "analysis"), data);
}

export function readAnalysis(sessionId: string): AnalysisResult {
  try {
    return readJson<AnalysisResult>(file(sessionId, "analysis"));
  } catch (err) {
    if (isMissing(err)) {
      throw new Error(`No analysis for session '${sessionId}' (analysis did not complete). Start a new session with analyze_dependency_usage.`);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Requirements
// ---------------------------------------------------------------------------

export function writeRequirements(sessionId: string, data: MigrationRequirements): void {
  writeJson(file(sessionId, "requirements"), data);
}

export function readRequirements(sessionId: string): MigrationRequirements {
  try {
    return readJson<MigrationRequirements>(file(sessionId, "requirements"));
  } catch (err) {
    if (isMissing(err)) {
      throw new Error(`No migration requirements for session '${sessionId}'. Call load_migration_requirements first.`);
    }
    throw err;
  }
}

export function readRequirementsIfExists(sessionId: string): MigrationRequirements | null {
  return fs.existsSync(file(sessionId, "requirements")) ? readJson<MigrationRequirements>(file(sessionId, "requirements")) : null;
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export function writePlan(sessionId: string, data: MigrationPlan): void {
  writeJson(file(sessionId, "plan"), data);
}

export function readPlan(sessionId: string): MigrationPlan {
  try {
    return readJson<MigrationPlan>(file(sessionId, "plan"));
  } catch (err) {
    if (isMissing(err)) {
      throw new Error(`No migration plan for session '${sessionId}'. Call generate_migration_plan first.`);
    }
    throw err;
  }
}

export function readPlanIfExists(sessionId: string): MigrationPlan | null {
  return fs.existsSync(file(sessionId, "plan")) ? readJson<MigrationPlan>(file(sessionId, "plan")) : null;
}

/**
 * Content hash that identifies a plan: it changes whenever a step's identity,
 * title, files, type or package edits change. Approval is bound to it.
 */
export function computePlanId(steps: MigrationStep[]): string {
  const content = steps.map(({ id, title, files, changeType, packageChanges }) => ({ id, title, files, changeType, packageChanges }));
  return createHash("sha256").update(JSON.stringify({ steps: content })).digest("hex").slice(0, 12);
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

export function writeChecks(sessionId: string, data: ChecksResult): void {
  writeJson(file(sessionId, "checks"), data);
}

export function readChecks(sessionId: string): ChecksResult {
  return readJson<ChecksResult>(file(sessionId, "checks"));
}

export function readChecksIfExists(sessionId: string): ChecksResult | null {
  return fs.existsSync(file(sessionId, "checks")) ? readJson<ChecksResult>(file(sessionId, "checks")) : null;
}

/** Every verify_migration run so far (oldest first). */
export function readChecksHistory(sessionId: string): ChecksHistoryEntry[] {
  return fs.existsSync(file(sessionId, "history")) ? readJson<{ entries: ChecksHistoryEntry[] }>(file(sessionId, "history")).entries : [];
}

/** Record a verify_migration run in the (sealed) history. */
export function appendChecksHistory(sessionId: string, result: ChecksResult): void {
  let entries: ChecksHistoryEntry[] = [];
  try {
    entries = readChecksHistory(sessionId);
  } catch {
    entries = []; // an untrusted history is replaced, never extended
  }
  entries.push({
    iteration: result.iteration,
    timestamp: result.timestamp,
    headCommit: result.headCommit,
    allPassed: result.allPassed,
    statuses: {
      dependencies: result.dependencies.status,
      lint: result.lint.status,
      test: result.test.status,
      build: result.build.status,
    },
    failedTests: result.test.failedTests.slice(0, 10),
    uncommitted: (result.uncommittedFiles ?? []).length > 0,
  });
  writeJson(file(sessionId, "history"), { entries });
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

/**
 * Approval gate: throws unless the CURRENT plan has a recorded approval.
 * Every source-changing tool (checkout_branch, apply_migration_patch,
 * create_pull_request) calls this before touching the repository.
 *
 * The plan ID is re-derived from the steps on every call, so approval cannot
 * carry over to steps that differ from the ones the user approved.
 */
export function assertPlanApproved(sessionId: string): MigrationPlan {
  const plan = readPlan(sessionId);
  if (computePlanId(plan.steps) !== plan.planId) {
    throw new Error(
      `Migration plan ${plan.planId} no longer matches its steps, so its approval is void. ` +
        `Start a new session with analyze_dependency_usage.`
    );
  }
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
  } catch (err) {
    if (isMissing(err)) {
      throw new Error(
        `Session '${sessionId}' not found. Call analyze_dependency_usage first to create a session ` +
          `(or get_session_status without a sessionId to list recent sessions).`
      );
    }
    throw err;
  }
}
