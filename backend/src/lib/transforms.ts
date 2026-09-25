/**
 * React 17 → 18 source-level transforms.
 *
 * Each exported function takes a file's source text and returns the
 * transformed text (unchanged if no relevant pattern is found).
 *
 * Design constraints:
 * - Transforms are regex / string-level only (no full AST rewrite).
 * - Each transform must be safe to apply repeatedly (idempotent).
 * - Complex multi-argument expressions that cannot be matched safely
 *   are deliberately left untouched; the migration plan marks those
 *   as manual steps.
 */

// ---------------------------------------------------------------------------
// Shared helper: split a ReactDOM call's argument string into (element, container).
//
// The challenge: the container argument can itself contain balanced parens,
// e.g. document.getElementById('root'), so a simple [^)]+ regex stops too
// early. Instead we find the LAST top-level comma (depth 0) in the raw arg
// string, which gives us the JSX element (first arg) and the container
// (second arg) reliably.
// ---------------------------------------------------------------------------

function splitReactArgs(args: string): { element: string; container: string } | null {
  // Track depth using only () [] {} — not <> which is unreliable in JSX source.
  // We want the LAST top-level comma, which separates the JSX element (1st arg)
  // from the container (2nd arg). For three-argument calls (with a callback),
  // this gives us the last comma before the callback — but we handle that by
  // checking that exactly two args exist below.
  let depth = 0;
  const topLevelCommas: number[] = [];
  for (let i = 0; i < args.length; i++) {
    const ch = args[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === "," && depth === 0) {
      topLevelCommas.push(i);
    }
  }
  // We only auto-transform two-argument calls (exactly one top-level comma).
  // Three-argument calls (ReactDOM.render with a callback) are left for manual
  // migration per react-bc-5.
  if (topLevelCommas.length !== 1) return null;
  const commaIdx = topLevelCommas[0];
  return {
    element: args.slice(0, commaIdx).trim(),
    container: args.slice(commaIdx + 1).trim(),
  };
}

/**
 * Given a source string, find all occurrences of `methodName(` and extract
 * the full argument list (balanced parentheses). Returns an array of
 * { start, end, args } where start/end are character indices of the full
 * call (from `methodName` to the matching `)`) and `args` is the raw
 * argument string inside the outermost parens.
 */
function findCalls(source: string, methodName: string): Array<{ start: number; end: number; args: string }> {
  const pattern = new RegExp(`${methodName.replace(".", "\\.")}\\(`, "g");
  const results: Array<{ start: number; end: number; args: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(source)) !== null) {
    const openPos = m.index + m[0].length; // position right after '('
    let depth = 1;
    let i = openPos;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      i++;
    }
    if (depth === 0) {
      results.push({
        start: m.index,
        end: i, // exclusive — character after matching ')'
        args: source.slice(openPos, i - 1),
      });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// react-bc-1: ReactDOM.render → createRoot().render()
//
// Handles these cases:
//   import ReactDOM from 'react-dom'              → import { createRoot } from 'react-dom/client'
//   import ReactDOM from "react-dom"              → (same, double-quote variant)
//   ReactDOM.render(<X />, container)            → createRoot(container).render(<X />)
//   ReactDOM.render(<X />, container)  (multi-line) — NOT rewritten (left manual)
//
// Safety: only rewrites two-argument calls where the first argument starts
// with a JSX element (< ...). Files already using createRoot are left unchanged.
// ---------------------------------------------------------------------------

export function transformReactDOMRender(source: string): string {
  // Guard: already migrated
  if (source.includes("createRoot")) return source;

  let result = source;

  // 1. Replace the default import for react-dom with the named createRoot import.
  result = result.replace(
    /^import\s+ReactDOM\s+from\s+['"]react-dom['"]\s*;?/m,
    "import { createRoot } from 'react-dom/client';"
  );

  // 2. Replace ReactDOM.render(element, container) calls using balanced-paren
  //    matching to correctly handle containers like document.getElementById('root').
  const calls = findCalls(result, "ReactDOM.render");
  // Process in reverse so that character positions remain valid
  for (const call of calls.reverse()) {
    const split = splitReactArgs(call.args);
    if (!split) continue;
    // Only transform if first argument looks like JSX
    if (!split.element.trimStart().startsWith("<")) continue;
    const replacement = `createRoot(${split.container}).render(${split.element})`;
    result = result.slice(0, call.start) + replacement + result.slice(call.end);
  }

  return result;
}

// ---------------------------------------------------------------------------
// react-bc-2: ReactDOM.hydrate → hydrateRoot()
//
// Handles:
//   import ReactDOM from 'react-dom'              → import { hydrateRoot } from 'react-dom/client'
//   ReactDOM.hydrate(<X />, container)           → hydrateRoot(container, <X />)
//
// Note the argument order swap: ReactDOM.hydrate(element, container)
//   → hydrateRoot(container, element).
//
// Files that already contain hydrateRoot are left unchanged.
// ---------------------------------------------------------------------------

export function transformReactDOMHydrate(source: string): string {
  // Guard: already migrated
  if (source.includes("hydrateRoot")) return source;

  // Only proceed if this file actually calls ReactDOM.hydrate
  if (!/ReactDOM\.hydrate\(/.test(source)) return source;

  let result = source;

  // 1. Replace the default import for react-dom
  result = result.replace(
    /^import\s+ReactDOM\s+from\s+['"]react-dom['"]\s*;?/m,
    "import { hydrateRoot } from 'react-dom/client';"
  );

  // 2. Replace ReactDOM.hydrate(element, container) using balanced-paren matching.
  //    Argument order is swapped: hydrateRoot(container, element).
  const calls = findCalls(result, "ReactDOM.hydrate");
  for (const call of calls.reverse()) {
    const split = splitReactArgs(call.args);
    if (!split) continue;
    if (!split.element.trimStart().startsWith("<")) continue;
    const replacement = `hydrateRoot(${split.container}, ${split.element})`;
    result = result.slice(0, call.start) + replacement + result.slice(call.end);
  }

  return result;
}

// ---------------------------------------------------------------------------
// react-bc-3: act() import from react-dom/test-utils → from 'react'
//
// Handles:
//   import { act } from 'react-dom/test-utils'
//     → import { act } from 'react'
//
//   import { act, other } from 'react-dom/test-utils'
//     → import { other } from 'react-dom/test-utils'
//        import { act } from 'react'
//
// Files that already import act from 'react' are left unchanged.
// ---------------------------------------------------------------------------

export function transformActImport(source: string): string {
  // Guard: already migrated
  if (/import\s+\{[^}]*\bact\b[^}]*\}\s+from\s+['"]react['"]/.test(source)) {
    return source;
  }

  // Case 1: only act is imported from test-utils (possibly with whitespace)
  //   import { act } from 'react-dom/test-utils'
  const onlyActRegex =
    /^import\s+\{\s*act\s*\}\s+from\s+['"]react-dom\/test-utils['"]\s*;?/m;
  if (onlyActRegex.test(source)) {
    return source.replace(
      onlyActRegex,
      "import { act } from 'react';"
    );
  }

  // Case 2: act is one of multiple named imports from test-utils
  //   import { act, render, screen } from 'react-dom/test-utils'
  const multiImportRegex =
    /^(import\s+\{)([^}]*\bact\b[^}]*)(\}\s+from\s+['"]react-dom\/test-utils['"]\s*;?)/m;
  const match = source.match(multiImportRegex);
  if (match) {
    const otherNames = match[2]
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "" && s !== "act");

    let replaced: string;
    if (otherNames.length === 0) {
      // Shouldn't normally hit this branch (covered above), but be safe
      replaced = source.replace(multiImportRegex, "import { act } from 'react';");
    } else {
      const remainingImport = `import { ${otherNames.join(", ")} } from 'react-dom/test-utils';`;
      const actImport = "import { act } from 'react';";
      replaced = source.replace(multiImportRegex, `${remainingImport}\n${actImport}`);
    }
    return replaced;
  }

  return source;
}

// ---------------------------------------------------------------------------
// Convenience dispatch used by applyMigrationPatch
// ---------------------------------------------------------------------------

export const REACT_TRANSFORMS: Record<string, (content: string) => string> = {
  "react-bc-1": transformReactDOMRender,
  "react-bc-2": transformReactDOMHydrate,
  "react-bc-3": transformActImport,
};
