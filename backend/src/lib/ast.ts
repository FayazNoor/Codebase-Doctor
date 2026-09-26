/**
 * AST helpers — find import sites AND concrete API usages of a dependency
 * family in a TS/JS repo.
 *
 * Uses ts-morph (TypeScript compiler) for .ts/.tsx/.js/.jsx/.mjs/.cjs files.
 * Two kinds of DependencyUsage records are produced:
 *
 *   kind "import" — one per import/require of a matching module
 *   kind "api"    — one per concrete use of an imported API:
 *                     ReactDOM.render(...)          (member call on default/namespace import)
 *                     <React.StrictMode>            (member access / JSX tag)
 *                     render(...) / <StrictMode>    (reference to a named import)
 *                     import { act } from '...'     (the named binding itself)
 *
 * Only syntactic bindings are tracked (no type checker): a local variable that
 * shadows an imported name may be over-reported. That is acceptable for
 * migration triage, and every record carries file/line for review.
 */

import fs from "node:fs";
import path from "node:path";
import { Node, Project, SyntaxKind, type SourceFile } from "ts-morph";
import type { DependencyUsage } from "../types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FindUsagesOptions {
  repoPath: string;
  /**
   * Package name, or a package family (e.g. ["react", "react-dom"]). Each
   * name matches the exact module and its subpaths ("react-dom/test-utils").
   */
  dependency: string | string[];
  /** File extensions to scan. Defaults to ts, tsx, js, jsx, mjs, cjs. */
  extensions?: string[];
  /** Restrict the scan to these repo-relative files (used for residual checks). */
  files?: string[];
}

/** How a local identifier is bound to an imported module. */
interface Binding {
  module: string;
  /** "default" / "*" (namespace) or the exported name for named imports. */
  imported: string;
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage", ".next", "out"]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Walk the repository and find every import of the dependency family plus every
 * concrete API usage of those imports.
 */
export function findDependencyUsages(opts: FindUsagesOptions): DependencyUsage[] {
  const {
    repoPath,
    extensions = ["ts", "tsx", "js", "jsx", "mjs", "cjs"],
  } = opts;
  const packages = Array.isArray(opts.dependency) ? opts.dependency : [opts.dependency];

  // A fresh Project per call (no global state). Files are always added by
  // walking the tree: relying on tsconfig "include" would silently skip JS
  // files (no allowJs) and test files in many repos.
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: { allowJs: true },
  });

  const files = opts.files
    ? opts.files.map((f) => path.join(repoPath, f)).filter((f) => fs.existsSync(f))
    : listSourceFiles(repoPath, extensions);
  for (const f of files) project.addSourceFileAtPath(f);

  const usages: DependencyUsage[] = [];
  for (const sourceFile of project.getSourceFiles()) {
    const rel = path.relative(repoPath, sourceFile.getFilePath()).split(path.sep).join("/");
    usages.push(...scanFile(sourceFile, rel, packages));
  }
  return usages;
}

/**
 * Return all named symbols imported from the dependency across all usages.
 */
export function collectImportedSymbols(usages: DependencyUsage[]): string[] {
  const symbols = new Set<string>();
  for (const u of usages) {
    if (u.kind === "api" && u.api) symbols.add(u.api);
  }
  return [...symbols];
}

/** True for test files: *.test.*, *.spec.*, or anything under __tests__/. */
export function isTestFile(file: string): boolean {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(file) || /(^|\/)__tests__\//.test(file);
}

// ---------------------------------------------------------------------------
// Per-file scan
// ---------------------------------------------------------------------------

function scanFile(sourceFile: SourceFile, rel: string, packages: string[]): DependencyUsage[] {
  const usages: DependencyUsage[] = [];
  const bindings = new Map<string, Binding>();
  /** Identifier nodes that declare a binding (skipped when collecting references). */
  const declarationNodes = new Set<Node>();
  const lines = sourceFile.getFullText().split("\n");

  const record = (node: Node, fields: Pick<DependencyUsage, "kind" | "module" | "api" | "argCount" | "importSpecifier">) => {
    const line = node.getStartLineNumber();
    const lineStart = sourceFile.compilerNode.getLineStarts()[line - 1] ?? 0;
    usages.push({
      file: rel,
      line,
      column: node.getStart() - lineStart,
      ...fields,
      usageContext: (lines[line - 1] ?? "").trim().slice(0, 120),
      riskScore: 0, // populated by risk.ts
      breakingChangeIds: [], // populated by risk.ts
    });
  };

  // --- ES imports -----------------------------------------------------------
  for (const decl of sourceFile.getImportDeclarations()) {
    const module = decl.getModuleSpecifierValue();
    if (!matchesFamily(module, packages)) continue;

    record(decl, { kind: "import", module, api: null, argCount: null, importSpecifier: extractImportSpecifier(decl) });

    const def = decl.getDefaultImport();
    if (def) {
      bindings.set(def.getText(), { module, imported: "default" });
      declarationNodes.add(def);
    }
    const ns = decl.getNamespaceImport();
    if (ns) {
      bindings.set(ns.getText(), { module, imported: "*" });
      declarationNodes.add(ns);
    }
    for (const named of decl.getNamedImports()) {
      const imported = named.getName();
      const localNode = named.getAliasNode() ?? named.getNameNode();
      bindings.set(localNode.getText(), { module, imported });
      declarationNodes.add(localNode);
      declarationNodes.add(named.getNameNode());
      // A named import is itself evidence the API is used by this file.
      record(named, { kind: "api", module, api: imported, argCount: null, importSpecifier: named.getText() });
    }
  }

  // --- CommonJS require() ----------------------------------------------------
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getText() !== "require") continue;
    const [arg] = call.getArguments();
    if (!arg || !Node.isStringLiteral(arg)) continue;
    const module = arg.getLiteralValue();
    if (!matchesFamily(module, packages)) continue;

    const parent = call.getParent();
    let spec = module;
    if (parent && Node.isVariableDeclaration(parent)) {
      const nameNode = parent.getNameNode();
      if (Node.isIdentifier(nameNode)) {
        bindings.set(nameNode.getText(), { module, imported: "default" });
        declarationNodes.add(nameNode);
        spec = nameNode.getText();
      } else if (Node.isObjectBindingPattern(nameNode)) {
        spec = nameNode.getText();
        for (const el of nameNode.getElements()) {
          const local = el.getNameNode();
          if (!Node.isIdentifier(local)) continue;
          const imported = el.getPropertyNameNode()?.getText() ?? local.getText();
          bindings.set(local.getText(), { module, imported });
          declarationNodes.add(local);
          const prop = el.getPropertyNameNode();
          if (prop) declarationNodes.add(prop);
          record(el, { kind: "api", module, api: imported, argCount: null, importSpecifier: el.getText() });
        }
      }
    }
    record(call, { kind: "import", module, api: null, argCount: null, importSpecifier: spec });
  }

  if (bindings.size === 0) return usages;

  // --- References to imported bindings --------------------------------------
  for (const id of sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)) {
    if (declarationNodes.has(id)) continue;
    const binding = bindings.get(id.getText());
    if (!binding) continue;
    const parent = id.getParent();
    if (!parent) continue;

    // Skip non-reference positions: `obj.name`, `{ name: v }`, import/export specifiers.
    if (Node.isPropertyAccessExpression(parent) && parent.getNameNode() === id) continue;
    if (Node.isPropertyAssignment(parent) && parent.getNameNode() === id) continue;
    if (Node.isImportSpecifier(parent) || Node.isExportSpecifier(parent)) continue;
    if (Node.isImportClause(parent) || Node.isNamespaceImport(parent)) continue;
    // `</StrictMode>` / `</React.StrictMode>` — the opening tag is already counted.
    if (Node.isJsxClosingElement(parent) || Node.isJsxClosingElement(parent.getParent() ?? parent)) continue;

    if (binding.imported === "default" || binding.imported === "*") {
      // Only member access on a default/namespace import is evidence of a
      // specific API (ReactDOM.render, React.StrictMode, express.json ...).
      if (!Node.isPropertyAccessExpression(parent) || parent.getExpression() !== id) continue;
      const api = parent.getName();
      record(parent, {
        kind: "api",
        module: binding.module,
        api,
        argCount: callArgCount(parent),
        importSpecifier: `${id.getText()}.${api}`,
      });
    } else {
      record(id, {
        kind: "api",
        module: binding.module,
        api: binding.imported,
        argCount: callArgCount(id),
        importSpecifier: id.getText(),
      });
    }
  }

  return usages;
}

/** Argument count if `node` is the callee of a call expression; else null. */
function callArgCount(node: Node): number | null {
  const parent = node.getParent();
  if (parent && Node.isCallExpression(parent) && parent.getExpression() === node) {
    return parent.getArguments().length;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function matchesFamily(specifier: string, packages: string[]): boolean {
  return packages.some((p) => specifier === p || specifier.startsWith(`${p}/`));
}

function listSourceFiles(dir: string, extensions: string[]): string[] {
  const extSet = new Set(extensions.map((e) => `.${e}`));
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(full);
      } else if (extSet.has(path.extname(entry.name)) && !entry.name.endsWith(".d.ts")) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out;
}

function extractImportSpecifier(decl: import("ts-morph").ImportDeclaration): string {
  const parts: string[] = [];
  const defaultImport = decl.getDefaultImport();
  if (defaultImport) parts.push(defaultImport.getText());
  const namedImports = decl.getNamedImports();
  if (namedImports.length > 0) {
    parts.push(`{ ${namedImports.map((n) => n.getText()).join(", ")} }`);
  }
  const nsImport = decl.getNamespaceImport();
  if (nsImport) parts.push(`* as ${nsImport.getText()}`);
  return parts.join(", ") || decl.getModuleSpecifierValue();
}
