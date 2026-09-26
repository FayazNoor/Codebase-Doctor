/**
 * Project metadata used in generated artifacts (PR body, report footer).
 *
 * The project URL is read from backend/package.json ("homepage") so it is
 * configured in one place; CODEBASE_DOCTOR_PROJECT_URL overrides it.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FALLBACK_URL = "https://github.com/FayazNoor/Codebase-Doctor";

export function projectUrl(): string {
  const override = process.env["CODEBASE_DOCTOR_PROJECT_URL"];
  if (override) return override;
  try {
    // src/lib/project.ts and dist/lib/project.js are both two levels below backend/.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(fs.readFileSync(path.resolve(here, "../../package.json"), "utf8")) as { homepage?: string };
    return pkg.homepage ?? FALLBACK_URL;
  } catch {
    return FALLBACK_URL;
  }
}
