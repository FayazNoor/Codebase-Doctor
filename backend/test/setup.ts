/**
 * Isolate all session/clone state in a throwaway directory so tests never
 * touch the developer's real ~/.codebase-doctor.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll } from "vitest";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "codebase-doctor-home-"));
process.env["CODEBASE_DOCTOR_HOME"] = home;

afterAll(() => {
  fs.rmSync(home, { recursive: true, force: true });
});
