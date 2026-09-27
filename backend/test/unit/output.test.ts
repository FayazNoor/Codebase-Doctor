/**
 * Command-output hygiene. The Jest sample mirrors the real output of the
 * demo app's first React 18 verification (examples/react17-demo-app).
 */

import { describe, it, expect } from "vitest";
import { cleanOutput, extractFailedTests, testSummary } from "../../src/lib/output.js";

const REPO = "C:\\Users\\dev\\.codebase-doctor\\repos\\o\\pantry-list\\17df354f";

const JEST = [
  "> pantry-list@1.0.0 test",
  "> jest",
  "",
  "PASS src/legacy/toast.test.jsx (12.552 s)",
  "  ● Console",
  "",
  "    console.error",
  "      Warning: The current testing environment is not configured to support act(...)",
  "",
  "    \u001b[0m \u001b[90m 16 |\u001b[39m   \u001b[36mconst\u001b[39m host \u001b[33m=\u001b[39m document",
  "",
  "FAIL src/components/SyncStatus.test.jsx (16.943 s)",
  "  ● shows the sync time once the save resolves",
  "",
  "    expect(received).toEqual(expected) // deep equality",
  `      at Object.toEqual (${REPO}\\src\\components\\SyncStatus.test.jsx:13:19)`,
  "",
  "FAIL src/broken.test.jsx",
  "  ● Test suite failed to run",
  "",
  "PASS src/App.test.jsx (17.571 s)",
  "",
  "Test Suites: 2 failed, 2 passed, 4 total",
  "Tests:       1 failed, 3 passed, 4 total",
].join("\n");

const VITEST = [
  " FAIL  src/cart.test.ts > Cart > applies the discount",
  " × src/cart.test.ts > rounds totals 3ms",
  "",
  " Test Files  1 failed (1)",
  "      Tests  2 failed | 7 passed (9)",
].join("\n");

describe("cleanOutput", () => {
  it("strips ANSI colour codes and hides the local clone path", () => {
    const out = cleanOutput(JEST, REPO);
    expect(out).not.toMatch(/\u001b\[/);
    expect(out).toContain("const host = document");
    expect(out).toContain("(<repo>\\src\\components\\SyncStatus.test.jsx:13:19)");
    expect(out).not.toContain("C:\\Users\\dev");
    expect(cleanOutput(`at ${REPO.replace(/\\/g, "/")}/src/a.js`, REPO)).toBe("at <repo>/src/a.js");
  });

  it("replaces the home directory (e.g. npm's log path) with ~", () => {
    const npm = "npm error A complete log of this run can be found in: C:\\Users\\dev\\AppData\\Local\\npm-cache\\_logs\\x.log";
    expect(cleanOutput(npm, undefined, "C:\\Users\\dev")).toBe(
      "npm error A complete log of this run can be found in: ~\\AppData\\Local\\npm-cache\\_logs\\x.log"
    );
    // the clone lives under the home directory: <repo> wins over ~
    expect(cleanOutput(`${REPO}\\src\\a.js`, REPO, "C:\\Users\\dev")).toBe("<repo>\\src\\a.js");
  });
});

describe("extractFailedTests", () => {
  it("Jest: failing tests and suites that did not run — never 'Console' or the FAIL header", () => {
    expect(extractFailedTests(JEST)).toEqual([
      "shows the sync time once the save resolves",
      "src/broken.test.jsx: test suite failed to run",
    ]);
  });

  it("Vitest: FAIL file > suite > test and × lines", () => {
    expect(extractFailedTests(VITEST)).toEqual(["Cart > applies the discount", "src/cart.test.ts > rounds totals"]);
  });
});

describe("testSummary", () => {
  it("reads the runner's own totals", () => {
    expect(testSummary(JEST)).toBe("Tests: 1 failed, 3 passed, 4 total");
    expect(testSummary(VITEST)).toBe("Tests: 2 failed | 7 passed (9)");
    expect(testSummary("no summary here")).toBeNull();
  });
});
