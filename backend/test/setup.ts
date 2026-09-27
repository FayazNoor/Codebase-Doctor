/**
 * Isolate all session/clone state in a throwaway directory so tests never
 * touch the developer's real ~/.codebase-doctor, and keep tests off the
 * network (no npm registry lookups; GitHub calls are mocked per test).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll } from "vitest";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "codebase-doctor-home-"));
process.env["CODEBASE_DOCTOR_HOME"] = home;
process.env["CODEBASE_DOCTOR_OFFLINE"] = "1";

afterAll(() => {
  fs.rmSync(home, { recursive: true, force: true });
});
