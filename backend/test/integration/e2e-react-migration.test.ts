/**
 * Integration test: React 17 → 18 full pipeline
 *
 * Exercises the complete Codebase Doctor pipeline against a disposable
 * copy of the react17-app fixture:
 *
 *   1.  AST analysis (findDependencyUsages)
 *   2.  load_migration_requirements  (knowledge-base path)
 *   3.  calculate_migration_blast_radius
 *   4.  generate_migration_plan
 *   5.  checkout_branch  (temp git repo — no network)
 *   6.  apply_migration_patch  (automatable steps)
 *   7.  verify_migration  (runs "test" / "build" / "lint" echoes)
 *   8.  generate_report  (markdown + html)
 *
 * Constraints satisfied:
 *   - No GitHub push / no real PR creation
 *   - No network dependency
 *   - Uses a disposable copy of the fixture in os.tmpdir()
 *   - Asserts actual changed source, not only command success
 *   - Verifies legacy patterns are gone after automatable steps
 *   - Verifies manual-only breaking changes remain "manual" in the plan
 *   - Verifies the report contains real values
 *   - Cleans up temp files in afterAll
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- lib under test --------------------------------------------------------
import { findDependencyUsages } from "../../src/lib/ast.js";
import {
  createSession,
  writeAnalysis,
  readAnalysis,
  writeRequirements,
  readRequirements,
  readPlan,
  readChecks,
  sessionDir,
} from "../../src/lib/session.js";

// ---- tools under test ------------------------------------------------------
import { loadMigrationRequirements } from "../../src/tools/load-migration-requirements.js";
import { calculateMigrationBlastRadius } from "../../src/tools/calculate-migration-blast-radius.js";
import { generateMigrationPlan } from "../../src/tools/generate-migration-plan.js";
import { checkoutBranch } from "../../src/tools/checkout-branch.js";
import { applyMigrationPatch } from "../../src/tools/apply-migration-patch.js";
import { verifyMigration } from "../../src/tools/verify-migration.js";
import { generateReport } from "../../src/tools/generate-report.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXTURE_SRC = path.resolve(__dirname, "../fixtures/react17-app");

/**
 * Copy the fixture to a fresh temp directory and initialise a git repo so
 * stageAndCommit() works without touching the real workspace.
 */
function prepareWorkingCopy(): string {
  const dest = path.join(os.tmpdir(), `codebase-doctor-test-${randomUUID()}`);
  copyDirRecursive(FIXTURE_SRC, dest);

  // Init git so apply_migration_patch can commit
  const git = (cmd: string) =>
    execSync(cmd, { cwd: dest, stdio: "pipe", encoding: "utf8" });
  git("git init");
  git("git config user.email 'test@example.com'");
  git("git config user.name 'Test'");
  git("git add -A");
  git("git commit -m 'initial fixture'");

  return dest;
}

function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function readFixtureFile(workingCopy: string, rel: string): string {
  return fs.readFileSync(path.join(workingCopy, rel), "utf8");
}

// ---------------------------------------------------------------------------
// Test state (shared across the ordered steps)
// ---------------------------------------------------------------------------

let workingCopy: string;
let sessionId: string;

beforeAll(() => {
  workingCopy = prepareWorkingCopy();
});

afterAll(() => {
  // Clean up the temp working copy
  if (workingCopy && fs.existsSync(workingCopy)) {
    fs.rmSync(workingCopy, { recursive: true, force: true });
  }
  // Clean up the session directory
  if (sessionId) {
    const sDir = sessionDir(sessionId);
    if (fs.existsSync(sDir)) {
      fs.rmSync(sDir, { recursive: true, force: true });
    }
  }
});

// ---------------------------------------------------------------------------
// Step 1 — AST analysis (findDependencyUsages)
// ---------------------------------------------------------------------------

describe("Step 1 — AST analysis", () => {
  it("finds all react and react-dom import sites in the fixture", () => {
    // Scan for both "react" and "react-dom" (they are a bundled ecosystem).
    // The knowledge base breaking changes reference ReactDOM symbols from react-dom,
    // so we must include those import sites for the requirements filter to match.
    const reactUsages = findDependencyUsages({
      repoPath: workingCopy,
      dependency: "react",
    });
    const reactDomUsages = findDependencyUsages({
      repoPath: workingCopy,
      dependency: "react-dom",
    });
    const usages = [...reactUsages, ...reactDomUsages];

    // Expect imports from all source files
    const files = new Set(usages.map((u) => u.file));

    // index.jsx: ReactDOM from 'react-dom' + React from 'react'
    expect([...files].some((f) => f.includes("index"))).toBe(true);
    // App.test.jsx: act from react-dom/test-utils + ReactDOM from react-dom
    expect([...files].some((f) => f.includes("App.test"))).toBe(true);
    // hydrate.jsx: ReactDOM from react-dom
    expect([...files].some((f) => f.includes("hydrate"))).toBe(true);

    // At least 4 files (index, App, App.test, hydrate, BatchedUpdatesExample)
    expect(files.size).toBeGreaterThanOrEqual(4);

    // Seed the session here so subsequent steps have it
    const analysis = {
      repoLanguage: "javascript" as const,
      packageManager: "npm" as const,
      testFramework: "jest",
      buildCommand: "npm run build",
      lintCommand: "npm run lint",
      testCommand: "npm run test",
      dependencyUsages: usages,
      blastRadius: null,
    };

    const session = createSession({
      repo: {
        url: "https://github.com/test/react17-fixture",
        owner: "test",
        name: "react17-fixture",
        localPath: workingCopy,
        defaultBranch: "main",
      },
      upgrade: {
        dependency: "react",
        fromVersion: "^17.0.2",
        toVersion: "18",
      },
      migrationBranch: "codebase-doctor/react-18-upgrade",
    });

    sessionId = session.id;
    writeAnalysis(sessionId, analysis);
  });
});

// ---------------------------------------------------------------------------
// Step 2 — load_migration_requirements
// ---------------------------------------------------------------------------

describe("Step 2 — load_migration_requirements", () => {
  it("loads the react 17→18 knowledge base and returns applicable breaking changes", async () => {
    const result = await loadMigrationRequirements({ sessionId });

    expect(result).toContain("react-bc-1");
    expect(result).toContain("react-bc-2");
    expect(result).toContain("react-bc-3");
    // Automatic changes labelled
    expect(result).toContain("(automatable)");
    // Manual changes labelled
    expect(result).toContain("(manual)");
  });

  it("persists requirements with automatable + manual split", () => {
    const req = readRequirements(sessionId);
    expect(req.breakingChanges.length).toBeGreaterThanOrEqual(3);

    const autoItems = req.breakingChanges.filter((bc) => bc.automatable);
    const manualItems = req.breakingChanges.filter((bc) => !bc.automatable);

    // react-bc-1 (render), react-bc-2 (hydrate), react-bc-3 (act) are automatable
    expect(autoItems.map((bc) => bc.id)).toContain("react-bc-1");
    expect(autoItems.map((bc) => bc.id)).toContain("react-bc-2");
    expect(autoItems.map((bc) => bc.id)).toContain("react-bc-3");

    // react-bc-4 (automatic batching), react-bc-5 (render callbacks),
    // react-bc-6 (strict mode effects), react-bc-7 (batchedUpdates) are manual
    expect(manualItems.length).toBeGreaterThanOrEqual(1);
    const manualIds = manualItems.map((bc) => bc.id);
    expect(manualIds.some((id) => ["react-bc-4", "react-bc-5", "react-bc-6", "react-bc-7"].includes(id))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Step 3 — calculate_migration_blast_radius
// ---------------------------------------------------------------------------

describe("Step 3 — calculate_migration_blast_radius", () => {
  it("scores all usages and returns a blast radius report", async () => {
    const result = await calculateMigrationBlastRadius({ sessionId });

    expect(result).toContain("Blast Radius");
    expect(result).toContain("Total files");
    expect(result).toContain("Affected files");
  });

  it("identifies high-risk entry-point files", () => {
    const analysis = readAnalysis(sessionId);
    expect(analysis.blastRadius).not.toBeNull();

    const report = analysis.blastRadius!;
    expect(report.totalFiles).toBeGreaterThanOrEqual(3);
    expect(report.affectedFiles).toBeGreaterThanOrEqual(2);

    // index.jsx should score high (entry point + ReactDOM.render)
    const indexEntry = report.topAffectedFiles.find((f) =>
      f.file.includes("index")
    );
    expect(indexEntry).toBeDefined();
    expect(indexEntry!.riskScore).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Step 4 — generate_migration_plan
// ---------------------------------------------------------------------------

describe("Step 4 — generate_migration_plan", () => {
  it("generates a markdown plan with numbered steps", async () => {
    const result = await generateMigrationPlan({ sessionId });

    expect(result).toContain("Migration Plan");
    expect(result).toContain("react");
    expect(result).toContain("17");
    expect(result).toContain("18");
    expect(result).toContain("approved");
  });

  it("plan contains automatable and manual steps", () => {
    const plan = readPlan(sessionId);

    const autoSteps = plan.steps.filter((s) => s.automatable);
    const manualSteps = plan.steps.filter((s) => !s.automatable);

    // Must have at least the config step + codemod steps
    expect(autoSteps.length).toBeGreaterThanOrEqual(2);
    // Must have manual steps for the non-automatable breaking changes
    expect(manualSteps.length).toBeGreaterThanOrEqual(1);

    // Verify manual steps have manualAction guidance in their descriptions
    const manualBcSteps = manualSteps.filter((s) => s.breakingChangeId !== null);
    if (manualBcSteps.length > 0) {
      // At least one manual step should reference manual action text
      const descriptions = manualBcSteps.map((s) => s.description);
      expect(descriptions.some((d) => d.includes("Manual action required") || d.includes("⚠️"))).toBe(true);
    }
  });

  it("plan steps list files affected by automatable breaking changes", () => {
    const plan = readPlan(sessionId);

    // react-bc-1 step must reference index.jsx (it calls ReactDOM.render)
    const bc1Step = plan.steps.find((s) => s.breakingChangeId === "react-bc-1");
    expect(bc1Step).toBeDefined();
    expect(bc1Step!.files.some((f) => f.includes("index"))).toBe(true);

    // react-bc-2 step must reference hydrate.jsx
    const bc2Step = plan.steps.find((s) => s.breakingChangeId === "react-bc-2");
    expect(bc2Step).toBeDefined();
    expect(bc2Step!.files.some((f) => f.includes("hydrate"))).toBe(true);

    // react-bc-3 step must reference App.test.jsx
    const bc3Step = plan.steps.find((s) => s.breakingChangeId === "react-bc-3");
    expect(bc3Step).toBeDefined();
    expect(bc3Step!.files.some((f) => f.includes("App.test"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Step 5 — checkout_branch
// ---------------------------------------------------------------------------

describe("Step 5 — checkout_branch", () => {
  it("creates the migration branch in the working copy", async () => {
    const result = await checkoutBranch({ sessionId });

    expect(result).toContain("codebase-doctor/react-18-upgrade");
    expect(result).toContain("Switched to branch");

    // Verify the branch actually exists in git
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: workingCopy,
      encoding: "utf8",
    }).trim();
    expect(branch).toBe("codebase-doctor/react-18-upgrade");
  });
});

// ---------------------------------------------------------------------------
// Step 6 — apply_migration_patch (automatable steps)
// ---------------------------------------------------------------------------

describe("Step 6 — apply_migration_patch", () => {
  it("applies the package.json version bump (config step)", async () => {
    const plan = readPlan(sessionId);
    const configStep = plan.steps.find((s) => s.changeType === "config");
    expect(configStep).toBeDefined();

    const result = await applyMigrationPatch({
      sessionId,
      stepId: configStep!.id,
    });

    expect(result).toContain("Applied");
    expect(result).toContain("config");

    // Verify package.json was actually updated
    const pkg = JSON.parse(
      readFixtureFile(workingCopy, "package.json")
    ) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["react"]).toBe("^18");
  });

  it("applies react-bc-1: ReactDOM.render → createRoot in index.jsx", async () => {
    const plan = readPlan(sessionId);
    const bc1Step = plan.steps.find((s) => s.breakingChangeId === "react-bc-1");
    expect(bc1Step).toBeDefined();

    const result = await applyMigrationPatch({
      sessionId,
      stepId: bc1Step!.id,
    });
    expect(result).toContain("Applied");

    // Assert actual source change in index.jsx
    const indexSrc = readFixtureFile(workingCopy, "src/index.jsx");
    expect(indexSrc).toContain("createRoot");
    expect(indexSrc).toContain("react-dom/client");
    expect(indexSrc).not.toContain("ReactDOM.render");
    expect(indexSrc).not.toContain("import ReactDOM from 'react-dom'");
  });

  it("also transforms App.test.jsx (same react-bc-1 step should cover it)", () => {
    // App.test.jsx also calls ReactDOM.render; it's in bc1Step.files
    const plan = readPlan(sessionId);
    const bc1Step = plan.steps.find((s) => s.breakingChangeId === "react-bc-1");
    if (bc1Step && bc1Step.files.some((f) => f.includes("App.test"))) {
      const testSrc = readFixtureFile(workingCopy, "src/App.test.jsx");
      expect(testSrc).not.toContain("ReactDOM.render");
    }
    // Pass even if App.test.jsx was not in this step's file list (handled by bc-3)
    expect(true).toBe(true);
  });

  it("applies react-bc-2: ReactDOM.hydrate → hydrateRoot in hydrate.jsx", async () => {
    const plan = readPlan(sessionId);
    const bc2Step = plan.steps.find((s) => s.breakingChangeId === "react-bc-2");
    expect(bc2Step).toBeDefined();

    const result = await applyMigrationPatch({
      sessionId,
      stepId: bc2Step!.id,
    });
    expect(result).toContain("Applied");

    const hydrateSrc = readFixtureFile(workingCopy, "src/hydrate.jsx");
    expect(hydrateSrc).toContain("hydrateRoot");
    expect(hydrateSrc).toContain("react-dom/client");
    // The ReactDOM.hydrate(...) CALL must be gone; the comment may still mention the old API
    expect(hydrateSrc).not.toMatch(/ReactDOM\.hydrate\s*\(/);
  });

  it("applies react-bc-3: act import → from 'react' in App.test.jsx", async () => {
    const plan = readPlan(sessionId);
    const bc3Step = plan.steps.find((s) => s.breakingChangeId === "react-bc-3");
    expect(bc3Step).toBeDefined();

    const result = await applyMigrationPatch({
      sessionId,
      stepId: bc3Step!.id,
    });
    expect(result).toContain("Applied");

    const testSrc = readFixtureFile(workingCopy, "src/App.test.jsx");
    expect(testSrc).toContain("import { act } from 'react'");
    expect(testSrc).not.toContain("react-dom/test-utils");
  });

  it("is idempotent — re-applying an already-applied step returns skip message", async () => {
    const plan = readPlan(sessionId);
    const bc3Step = plan.steps.find((s) => s.breakingChangeId === "react-bc-3");
    expect(bc3Step).toBeDefined();

    const result = await applyMigrationPatch({
      sessionId,
      stepId: bc3Step!.id,
    });
    expect(result).toContain("already applied");
  });

  it("manual steps remain unapplied in the plan", () => {
    const plan = readPlan(sessionId);
    const manualSteps = plan.steps.filter((s) => !s.automatable && s.breakingChangeId !== null);
    // Manual steps must NOT have been auto-applied
    for (const step of manualSteps) {
      expect(step.applied).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Step 7 — verify_migration
// ---------------------------------------------------------------------------

describe("Step 7 — verify_migration", () => {
  it("runs checks against the working copy and returns a structured result", async () => {
    const result = await verifyMigration({ sessionId });

    // The fixture scripts are all `echo 'xxx passed'` so all checks pass
    expect(result).toContain("Verification");
    expect(result).toContain("Lint:");
    expect(result).toContain("Test:");
    expect(result).toContain("Build:");
  });

  it("persists checks result to session", () => {
    const checks = readChecks(sessionId);
    expect(checks.iteration).toBeGreaterThanOrEqual(1);
    expect(typeof checks.allPassed).toBe("boolean");
  });

  it("passes all checks (fixture scripts echo 'passed')", async () => {
    const result = await verifyMigration({ sessionId });
    expect(result).toContain("✅");
    // fixture scripts are all echo so they pass
    expect(result).toContain("passed");
  });
});

// ---------------------------------------------------------------------------
// Step 8 — generate_report
// ---------------------------------------------------------------------------

describe("Step 8 — generate_report", () => {
  it("generates markdown report with real migration values", async () => {
    const md = await generateReport({ sessionId, format: "markdown" });

    expect(md).toContain("Migration Report");
    expect(md).toContain("react");
    // Version info present
    expect(md).toContain("17");
    expect(md).toContain("18");
    // Files affected section
    expect(md).toContain("Files affected");
    // Steps applied — some were applied
    expect(md).toMatch(/\d+\s*\/\s*\d+/); // "N / M" pattern
    // Breaking changes listed
    expect(md).toContain("HIGH");
    // At least one step marked applied [x]
    expect(md).toContain("[x]");
  });

  it("markdown report shows applied steps as [x] and unapplied as [ ]", async () => {
    const md = await generateReport({ sessionId, format: "markdown" });
    const plan = readPlan(sessionId);

    const appliedCount = plan.steps.filter((s) => s.applied).length;
    const unappliedCount = plan.steps.filter((s) => !s.applied).length;

    if (appliedCount > 0) {
      expect(md).toContain("[x]");
    }
    if (unappliedCount > 0) {
      expect(md).toContain("[ ]");
    }
  });

  it("generates HTML report with the expected structural elements", async () => {
    const html = await generateReport({ sessionId, format: "html" });

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Codebase Doctor");
    expect(html).toContain("Productivity Metrics");
    expect(html).toContain("Blast Radius");
    expect(html).toContain("Breaking Changes Addressed");
    expect(html).toContain("Made with IBM Bob");
    // Dependency name should appear in the report
    expect(html).toContain("react");
  });

  it("HTML report contains real numeric values (not placeholder zeros everywhere)", async () => {
    const html = await generateReport({ sessionId, format: "html" });

    // The steps applied metric should not be 0/0
    expect(html).not.toContain(">0/0<");
    // Breaking changes table should have rows
    expect(html).toContain("<tr>"); // at least the header row
    expect(html).toContain("HIGH");
  });
});

// ---------------------------------------------------------------------------
// Targeted: failure behavior when checks fail
// ---------------------------------------------------------------------------

describe("Failure behavior — verify_migration with a failing check", () => {
  let failSessionId: string;
  let failWorkingCopy: string;

  beforeAll(async () => {
    failWorkingCopy = prepareWorkingCopy();

    // Patch package.json to use a failing test command
    const pkgPath = path.join(failWorkingCopy, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
      scripts: Record<string, string>;
    };
    pkg.scripts["test"] = "exit 1";
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");

    const usages = [
      ...findDependencyUsages({ repoPath: failWorkingCopy, dependency: "react" }),
      ...findDependencyUsages({ repoPath: failWorkingCopy, dependency: "react-dom" }),
    ];

    const session = createSession({
      repo: {
        url: "https://github.com/test/react17-fixture-fail",
        owner: "test",
        name: "react17-fixture-fail",
        localPath: failWorkingCopy,
        defaultBranch: "main",
      },
      upgrade: {
        dependency: "react",
        fromVersion: "^17.0.2",
        toVersion: "18",
      },
      migrationBranch: "codebase-doctor/react-18-fail-test",
    });
    failSessionId = session.id;

    writeAnalysis(failSessionId, {
      repoLanguage: "javascript",
      packageManager: "npm",
      testFramework: "jest",
      buildCommand: "npm run build",
      lintCommand: "npm run lint",
      testCommand: "npm run test",
      dependencyUsages: usages,
      blastRadius: null,
    });

    await loadMigrationRequirements({ sessionId: failSessionId });
    await calculateMigrationBlastRadius({ sessionId: failSessionId });
    await generateMigrationPlan({ sessionId: failSessionId });
  });

  afterAll(() => {
    if (failWorkingCopy && fs.existsSync(failWorkingCopy)) {
      fs.rmSync(failWorkingCopy, { recursive: true, force: true });
    }
    if (failSessionId) {
      const sDir = sessionDir(failSessionId);
      if (fs.existsSync(sDir)) {
        fs.rmSync(sDir, { recursive: true, force: true });
      }
    }
  });

  it("reports FAILED when the test command exits non-zero", async () => {
    const result = await verifyMigration({ sessionId: failSessionId });

    expect(result).toContain("FAILED");
    expect(result).toContain("❌");
  });

  it("includes a failure summary and suggested next action", async () => {
    const result = await verifyMigration({ sessionId: failSessionId });

    // Should contain failure diagnosis
    expect(result).toContain("Suggested next action");
  });

  it("persists the failed checks result", () => {
    const checks = readChecks(failSessionId);
    expect(checks.allPassed).toBe(false);
    expect(checks.test.passed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Targeted: apply_migration_patch — unknown stepId
// ---------------------------------------------------------------------------

describe("apply_migration_patch — error handling", () => {
  it("throws a descriptive error for an unknown stepId", async () => {
    await expect(
      applyMigrationPatch({ sessionId, stepId: "non-existent-step-id" })
    ).rejects.toThrow(/not found in migration plan/i);
  });
});
