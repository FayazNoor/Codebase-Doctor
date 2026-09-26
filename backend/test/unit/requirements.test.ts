import { describe, it, expect } from "vitest";
import { buildRequirements, parseDocsSections } from "../../src/lib/requirements.js";
import { findDependencyUsages } from "../../src/lib/ast.js";
import { resolveEcosystem } from "../../src/lib/ecosystem.js";
import { hasTransform } from "../../src/lib/transforms.js";
import { FIXTURE_SRC } from "../helpers.js";

const usages = findDependencyUsages({ repoPath: FIXTURE_SRC, dependency: resolveEcosystem("react").packages });
const base = { dependency: "react", fromVersion: "^17.0.2", toVersion: "18.3.1", usages };

/** Representative excerpt shaped like the official React 18 upgrade guide. */
const GUIDE_MARKDOWN = `
# How to Upgrade to React 18

## Updates to Client Rendering APIs
### Deprecated: render and hydrate
ReactDOM.render is no longer supported in React 18. Use createRoot instead.
ReactDOM.hydrate is replaced by hydrateRoot.
We also removed the callback from render.

## Automatic Batching
React 18 adds automatic batching for timeouts, promises and native event handlers.

## Updates to Strict Mode
StrictMode will simulate unmounting and remounting components.

## Configuring Your Testing Environment
act from react-dom/test-utils … set IS_REACT_ACT_ENVIRONMENT.

## Other Breaking Changes
- Consistent useEffect timing for discrete input events
- Stricter hydration errors

## Deprecated server APIs
- \`renderToNodeStream\`
`;

/** Plain text as extracted from a PDF — no Markdown headings. */
const GUIDE_PLAIN_TEXT = `How to Upgrade to React 18
Updates to Client Rendering APIs
ReactDOM.render is no longer supported in React 18. Use createRoot.
Automatic Batching`;

describe("buildRequirements — canonical knowledge base", () => {
  it("React migration without docsText uses canonical react-bc-* IDs", () => {
    const req = buildRequirements(base);
    expect(req.knowledgeBase).toBe("react-17-to-18.json");
    expect(req.docsSupplied).toBe(false);
    expect(req.breakingChanges.map((b) => b.id)).toEqual([
      "react-bc-1", "react-bc-2", "react-bc-3", "react-bc-4", "react-bc-6", "react-bc-7",
    ]);
    // bc-5 (render callback) has no evidence in the fixture → not applicable
    expect(req.breakingChanges.every((b) => b.docsConfirmed === undefined)).toBe(true);
  });

  it("uses react-dom evidence (render/hydrate/test-utils) to decide applicability", () => {
    const onlyReactPackage = findDependencyUsages({ repoPath: FIXTURE_SRC, dependency: "react" });
    const req = buildRequirements({ ...base, usages: onlyReactPackage });
    // Without react-dom usages the ReactDOM rules cannot be detected — which is
    // exactly why analysis scans the whole family.
    expect(req.breakingChanges.map((b) => b.id)).not.toContain("react-bc-1");
  });
});

describe("buildRequirements — user-supplied docs", () => {
  it("preserves canonical IDs and marks rules confirmed by the docs", () => {
    const req = buildRequirements({ ...base, docsText: GUIDE_MARKDOWN });
    const ids = req.breakingChanges.map((b) => b.id);
    for (const id of ["react-bc-1", "react-bc-2", "react-bc-3", "react-bc-4", "react-bc-6", "react-bc-7"]) {
      expect(ids).toContain(id);
    }
    const byId = Object.fromEntries(req.breakingChanges.map((b) => [b.id, b]));
    expect(byId["react-bc-1"].docsConfirmed).toBe(true);
    expect(byId["react-bc-3"].docsConfirmed).toBe(true);
    expect(byId["react-bc-7"].docsConfirmed).toBe(false); // not mentioned — kept, flagged
  });

  it("keeps automated transforms reachable when docs are supplied", () => {
    const req = buildRequirements({ ...base, docsText: GUIDE_MARKDOWN });
    const automated = req.breakingChanges.filter((b) => b.automatable && hasTransform(b.id)).map((b) => b.id);
    expect(automated).toEqual(["react-bc-1", "react-bc-2", "react-bc-3"]);
  });

  it("adds unmatched docs sections as manual docs-* rules and never automates them", () => {
    const req = buildRequirements({ ...base, docsText: GUIDE_MARKDOWN });
    const docsOnly = req.breakingChanges.filter((b) => b.source === "docs");
    // "Other Breaking Changes" (no API names) is kept for manual review;
    // "Deprecated server APIs" lists renderToNodeStream, which the repo never uses.
    expect(docsOnly.map((b) => b.description)).toEqual(["Other Breaking Changes"]);
    expect(docsOnly[0].id).toMatch(/^docs-\d+$/);
    expect(docsOnly[0].automatable).toBe(false);
    expect(hasTransform(docsOnly[0].id)).toBe(false);
  });

  it("plain-text (PDF-extracted) docs validate canonical rules without inventing new ones", () => {
    const req = buildRequirements({ ...base, docsText: GUIDE_PLAIN_TEXT });
    expect(req.breakingChanges.some((b) => b.source === "docs")).toBe(false);
    expect(req.breakingChanges.find((b) => b.id === "react-bc-1")!.docsConfirmed).toBe(true);
  });

  it("parses breaking-change sections from Markdown headings", () => {
    const sections = parseDocsSections(GUIDE_MARKDOWN);
    expect(sections.map((s) => s.title)).toEqual([
      "Deprecated: render and hydrate",
      "Other Breaking Changes",
      "Deprecated server APIs",
    ]);
    expect(sections[2].apis).toEqual(["renderToNodeStream"]);
  });
});

describe("buildRequirements — version applicability", () => {
  it("does not apply 17→18 rules to a React 19 upgrade", () => {
    const req = buildRequirements({ ...base, fromVersion: "^18.2.0", toVersion: "19.0.0" });
    expect(req.knowledgeBase).toBeNull();
    expect(req.breakingChanges).toHaveLength(0);
    expect(req.warnings[0]).toMatch(/No built-in rules/);
  });

  it("warns that pre-17 changes are not covered for a React 16 repo", () => {
    const req = buildRequirements({ ...base, fromVersion: "^16.3.0" });
    expect(req.knowledgeBase).toBe("react-17-to-18.json");
    expect(req.warnings.join(" ")).toMatch(/16\.3\.0.*17 → 18/);
  });
});
