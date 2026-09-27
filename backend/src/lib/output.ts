/**
 * Command output hygiene for reports, tool results and PR bodies.
 *
 * - Strips ANSI colour codes (Jest colours code frames even with CI=true).
 * - Replaces the session clone's absolute path with `<repo>` and the home
 *   directory with `~` (e.g. npm's log path), so outputs are readable and do
 *   not leak local usernames/paths into reports or PRs.
 * - Parses failing test names from Jest and Vitest output.
 */

import os from "node:os";

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

/** A path as it may appear in output: native, forward-slash, backslash, and JSON-escaped backslash forms. */
function pathVariants(p: string): string[] {
  const forms = [p, p.replace(/\\/g, "/"), p.replace(/\//g, "\\"), p.replace(/\//g, "\\").replace(/\\/g, "\\\\")];
  return [...new Set(forms)].filter((v) => v.length > 3).sort((a, b) => b.length - a.length);
}

export function cleanOutput(text: string, repoPath?: string, home: string = os.homedir()): string {
  let out = text.replace(ANSI, "").replace(/\r\n/g, "\n");
  if (repoPath) for (const v of pathVariants(repoPath)) out = out.split(v).join("<repo>");
  if (home) for (const v of pathVariants(home)) out = out.split(v).join("~");
  return out;
}

/**
 * Names of failing tests. Understands Jest (`● Suite › test`, verbose `✕ test`)
 * and Vitest (`× test`, `FAIL  file > suite > test`). Suites that could not run
 * are reported as `<file>: test suite failed to run`.
 */
export function extractFailedTests(output: string): string[] {
  const failed: string[] = [];
  let lastFailFile: string | null = null;
  for (const raw of cleanOutput(output).split("\n")) {
    const line = raw.trimEnd();
    const failFile = line.match(/^\s*FAIL\s+(\S+)(?:\s+\([\d.]+\s*m?s\))?\s*$/);
    if (failFile) {
      lastFailFile = failFile[1];
      continue;
    }
    const vitest = line.match(/^\s*FAIL\s+\S+\s+>\s+(.+)$/);
    if (vitest) {
      failed.push(vitest[1].trim());
      continue;
    }
    const bullet = line.match(/^\s*●\s+(.+?)\s*$/);
    if (bullet) {
      const name = bullet[1];
      if (/^Console$/i.test(name)) continue;
      failed.push(/^Test suite failed to run$/i.test(name) ? `${lastFailFile ?? "a test file"}: test suite failed to run` : name);
      continue;
    }
    const cross = line.match(/^\s*(?:✕|×)\s+(.+?)(?:\s+\d+(?:\.\d+)?\s*m?s)?(?:\s+\(\d+(?:\.\d+)?\s*m?s\))?\s*$/);
    if (cross) failed.push(cross[1].trim());
  }
  return [...new Set(failed)].slice(0, 20);
}

/** "Tests: 1 failed, 3 passed, 4 total" (Jest) or "Tests  1 failed | 3 passed (4)" (Vitest), if present. */
export function testSummary(output: string): string | null {
  const text = cleanOutput(output);
  const jest = text.match(/^\s*Tests:\s+(.+total)\s*$/m);
  if (jest) return `Tests: ${jest[1]}`;
  const vitest = text.match(/^\s*Tests\s+(.+\(\d+\))\s*$/m);
  return vitest ? `Tests: ${vitest[1]}` : null;
}
