/**
 * Session state — read/write JSON files in ~/.codebase-doctor/sessions/<id>/
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

const BASE_DIR = path.join(os.homedir(), ".codebase-doctor", "sessions");

export function sessionDir(sessionId: string): string {
  return path.join(BASE_DIR, sessionId);
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
  return readJson<MigrationRequirements>(requirementsFile(sessionId));
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export function writePlan(sessionId: string, data: MigrationPlan): void {
  writeJson(planFile(sessionId), data);
}

export function readPlan(sessionId: string): MigrationPlan {
  return readJson<MigrationPlan>(planFile(sessionId));
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

// ---------------------------------------------------------------------------
// Utility: assert session exists
// ---------------------------------------------------------------------------

export function assertSession(sessionId: string): Session {
  try {
    return readSession(sessionId);
  } catch {
    throw new Error(
      `Session '${sessionId}' not found. Call analyze_dependency_usage first to create a session.`
    );
  }
}
