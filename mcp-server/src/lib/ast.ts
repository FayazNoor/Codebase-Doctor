/**
 * AST helpers — find all import/require usages of a dependency in a TS/JS repo.
 *
 * Uses ts-morph for TypeScript projects and @babel/parser for plain JS.
 * Returns DependencyUsage records for every import of the target package.
 */

import fs from "node:fs";
import path from "node:path";
import { Project, SyntaxKind } from "ts-morph";
import type { DependencyUsage } from "../types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FindUsagesOptions {
  repoPath: string;
  dependency: string;
  /** File extensions to scan. Defaults to ts, tsx, js, jsx. */
  extensions?: string[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Walk the repository and find every import/require of `dependency`.
 * Returns one DependencyUsage per import site (not per use of each symbol).
 */
export function findDependencyUsages(opts: FindUsagesOptions): DependencyUsage[] {
  const { repoPath, dependency, extensions = ["ts", "tsx", "js", "jsx"] } = opts;

  const tsConfigPath = findTsConfig(repoPath);

  const project = new Project({
    tsConfigFilePath: tsConfigPath ?? undefined,
    addFilesFromTsConfig: tsConfigPath !== null,
    skipAddingFilesFromTsConfig: tsConfigPath === null,
    skipFileDependencyResolution: true,
  });

  if (tsConfigPath === null) {
    // No tsconfig — add files manually
    addFilesManually(project, repoPath, extensions);
  }

  const usages: DependencyUsage[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = path.relative(repoPath, sourceFile.getFilePath());

    // Skip node_modules and build output
    if (filePath.startsWith("node_modules") || filePath.startsWith("dist") || filePath.startsWith("build")) {
      continue;
    }

    // ES import declarations: import X from 'dependency'
    for (const decl of sourceFile.getImportDeclarations()) {
      const moduleSpecifier = decl.getModuleSpecifierValue();
      if (!isMatchingDep(moduleSpecifier, dependency)) continue;

      const pos = decl.getStartLineNumber();
      const col = decl.getStart() - sourceFile.getLineStarts()[pos - 1];
      const importSpecifier = extractImportSpecifier(decl);
      const usageContext = decl.getText().slice(0, 120);

      usages.push({
        file: filePath,
        line: pos,
        column: col,
        importSpecifier,
        usageContext,
        riskScore: 0, // populated later by risk.ts
        breakingChangeIds: [], // populated later by requirements mapper
      });
    }

    // CommonJS: require('dependency')
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expr = call.getExpression();
      if (expr.getText() !== "require") continue;
      const args = call.getArguments();
      if (args.length === 0) continue;
      const arg = args[0];
      if (arg.getKind() !== SyntaxKind.StringLiteral) continue;
      const specifier = arg.getText().replace(/['"]/g, "");
      if (!isMatchingDep(specifier, dependency)) continue;

      const pos = call.getStartLineNumber();
      const col = call.getStart() - sourceFile.getLineStarts()[pos - 1];

      usages.push({
        file: filePath,
        line: pos,
        column: col,
        importSpecifier: specifier,
        usageContext: call.getText().slice(0, 120),
        riskScore: 0,
        breakingChangeIds: [],
      });
    }
  }

  return usages;
}

/**
 * Return all named symbols imported from `dependency` across all usages.
 */
export function collectImportedSymbols(usages: DependencyUsage[]): string[] {
  const symbols = new Set<string>();
  for (const u of usages) {
    // importSpecifier may be "React, { useState, useEffect }" etc.
    const named = u.importSpecifier.match(/\{([^}]+)\}/);
    if (named) {
      for (const sym of named[1].split(",")) {
        symbols.add(sym.trim().split(" as ")[0].trim());
      }
    }
    const defaultMatch = u.importSpecifier.match(/^([A-Za-z_$][A-Za-z0-9_$]*)/);
    if (defaultMatch) symbols.add(defaultMatch[1]);
  }
  return [...symbols];
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function isMatchingDep(specifier: string, dependency: string): boolean {
  return specifier === dependency || specifier.startsWith(`${dependency}/`);
}

function findTsConfig(repoPath: string): string | null {
  const candidate = path.join(repoPath, "tsconfig.json");
  return fs.existsSync(candidate) ? candidate : null;
}

function addFilesManually(
  project: Project,
  dir: string,
  extensions: string[]
): void {
  const extSet = new Set(extensions.map((e) => `.${e}`));
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (["node_modules", ".git", "dist", "build", ".next"].includes(entry.name)) continue;
        walk(full);
      } else if (extSet.has(path.extname(entry.name))) {
        project.addSourceFileAtPath(full);
      }
    }
  };
  walk(dir);
}

function extractImportSpecifier(decl: ReturnType<Project["getSourceFiles"]>[number]["getImportDeclarations"][number][number]): string {
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
