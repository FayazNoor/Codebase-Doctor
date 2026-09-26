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
  // Not preceded by an identifier char or '.', so `MyReactDOM.render(` does not match.
  const pattern = new RegExp(`(?<![\\w$.])${escapeRegExp(methodName)}\\(`, "g");
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
// Shared: locate the react-dom default/namespace binding and manage imports
// ---------------------------------------------------------------------------

const REACT_DOM_IMPORT =
  /^import\s+(?:\*\s+as\s+)?([A-Za-z_$][\w$]*)\s+from\s+['"]react-dom['"]\s*;?[ \t]*$/m;

/** Local name of `import X from 'react-dom'` / `import * as X from 'react-dom'`. */
function reactDomBinding(source: string): string | null {
  return source.match(REACT_DOM_IMPORT)?.[1] ?? null;
}

/** Drop line and block comments (a comment mentioning ReactDOM is not a usage). */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * After calls were rewritten: if the react-dom binding is no longer referenced,
 * replace its import with `import { name } from 'react-dom/client'`; otherwise
 * keep it (other members such as unstable_batchedUpdates still need it) and
 * add/merge the named import from 'react-dom/client'.
 */
function fixReactDomImports(source: string, binding: string, name: string): string {
  const importMatch = source.match(REACT_DOM_IMPORT);
  if (!importMatch) return source;
  const withoutImport = stripComments(source.replace(REACT_DOM_IMPORT, ""));
  const stillUsed = new RegExp(`(?<![\\w$.])${escapeRegExp(binding)}\\b`).test(withoutImport);
  const removeImportLine = (text: string) => text.replace(new RegExp(REACT_DOM_IMPORT.source + "\\n?", "m"), "");

  const clientImport = /^import\s+\{([^}]*)\}\s+from\s+['"]react-dom\/client['"]\s*;?/m;
  const existing = source.match(clientImport);
  if (existing) {
    // Merge into the existing react-dom/client import.
    const names = existing[1].split(",").map((n) => n.trim()).filter(Boolean);
    let result = source;
    if (!names.includes(name)) {
      result = result.replace(clientImport, `import { ${[...names, name].join(", ")} } from 'react-dom/client';`);
    }
    return stillUsed ? result : removeImportLine(result);
  }
  const newImport = `import { ${name} } from 'react-dom/client';`;
  return stillUsed
    ? source.replace(REACT_DOM_IMPORT, `${importMatch[0].trimEnd()}\n${newImport}`)
    : source.replace(REACT_DOM_IMPORT, newImport);
}

/**
 * Rewrite `<binding>.<method>(element, container)` calls whose first argument
 * is JSX. Returns the new source and how many calls were rewritten.
 */
function rewriteRootCalls(
  source: string,
  binding: string,
  method: "render" | "hydrate",
  build: (element: string, container: string) => string
): { result: string; rewritten: number } {
  let result = source;
  let rewritten = 0;
  const calls = findCalls(result, `${binding}.${method}`);
  // Process in reverse so that character positions remain valid
  for (const call of calls.reverse()) {
    const split = splitReactArgs(call.args);
    if (!split) continue; // 3-argument (callback) calls stay manual — react-bc-5
    if (!split.element.trimStart().startsWith("<")) continue;
    result = result.slice(0, call.start) + build(split.element, split.container) + result.slice(call.end);
    rewritten++;
  }
  return { result, rewritten };
}

// ---------------------------------------------------------------------------
// react-bc-1: ReactDOM.render → createRoot().render()
//
// Handles these cases:
//   import ReactDOM from 'react-dom'              → import { createRoot } from 'react-dom/client'
//   import * as ReactDOM from "react-dom"         → (same; any local binding name works)
//   ReactDOM.render(<X />, container)             → createRoot(container).render(<X />)
//   multi-line JSX / containers with nested calls → handled (balanced parens)
//
// Safety: only rewrites two-argument calls whose first argument is JSX.
// Three-argument calls (render callback, react-bc-5) are left untouched. The
// react-dom import is only removed when nothing else in the file uses it.
// ---------------------------------------------------------------------------

export function transformReactDOMRender(source: string): string {
  const binding = reactDomBinding(source);
  if (!binding) return source;
  const { result, rewritten } = rewriteRootCalls(
    source,
    binding,
    "render",
    (element, container) => `createRoot(${container}).render(${element})`
  );
  if (rewritten === 0) return source; // nothing to do / already migrated
  return fixReactDomImports(result, binding, "createRoot");
}

// ---------------------------------------------------------------------------
// react-bc-2: ReactDOM.hydrate → hydrateRoot()
//
// Handles:
//   import ReactDOM from 'react-dom'              → import { hydrateRoot } from 'react-dom/client'
//   ReactDOM.hydrate(<X />, container)            → hydrateRoot(container, <X />)
//
// Note the argument order swap: ReactDOM.hydrate(element, container)
//   → hydrateRoot(container, element).
// ---------------------------------------------------------------------------

export function transformReactDOMHydrate(source: string): string {
  const binding = reactDomBinding(source);
  if (!binding) return source;
  const { result, rewritten } = rewriteRootCalls(
    source,
    binding,
    "hydrate",
    (element, container) => `hydrateRoot(${container}, ${element})`
  );
  if (rewritten === 0) return source;
  return fixReactDomImports(result, binding, "hydrateRoot");
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

/** True only for canonical rule IDs that have a known, tested transform. */
export function hasTransform(breakingChangeId: string): boolean {
  return Object.prototype.hasOwnProperty.call(REACT_TRANSFORMS, breakingChangeId);
}
