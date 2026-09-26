/**
 * Package families ("ecosystems").
 *
 * A migration of one package often involves companion packages that must be
 * analysed and upgraded together — e.g. React 17 → 18 is really a react +
 * react-dom (+ react-dom/client, react-dom/test-utils) migration. This module
 * is the single place that knows which packages belong together.
 *
 * Unknown dependencies resolve to a single-package ecosystem, so behaviour for
 * non-React dependencies is unchanged.
 */

export interface ApiRef {
  /** Exact module specifier, e.g. "react-dom" or "react-dom/client". */
  module: string;
  /** Exported API name, e.g. "render". */
  api: string;
}

export interface KnowledgeBaseRef {
  /** File name under src/knowledge/. */
  file: string;
  /** Major version the rules migrate FROM (older repos get a coverage warning). */
  fromMajor: number;
  /** Major version the rules migrate TO. Only used when the target major matches. */
  toMajor: number;
}

export interface Ecosystem {
  id: string;
  /** Packages whose imports are analysed together (exact name or name/subpath). */
  packages: string[];
  /**
   * Packages upgraded in lock-step to the same version range as the target
   * (only if already declared in package.json — never added).
   */
  syncedPackages: string[];
  /**
   * Type-definition packages bumped to ^<targetMajor> when already declared.
   */
  typePackages: string[];
  /** APIs whose call sites bootstrap the application root (risk-score context). */
  bootstrapApis: ApiRef[];
  knowledge: KnowledgeBaseRef[];
}

const ECOSYSTEMS: Ecosystem[] = [
  {
    id: "react",
    packages: ["react", "react-dom"],
    syncedPackages: ["react", "react-dom", "react-test-renderer"],
    typePackages: ["@types/react", "@types/react-dom"],
    bootstrapApis: [
      { module: "react-dom", api: "render" },
      { module: "react-dom", api: "hydrate" },
      { module: "react-dom/client", api: "createRoot" },
      { module: "react-dom/client", api: "hydrateRoot" },
    ],
    knowledge: [{ file: "react-17-to-18.json", fromMajor: 17, toMajor: 18 }],
  },
  {
    id: "express",
    packages: ["express"],
    syncedPackages: ["express"],
    typePackages: ["@types/express"],
    bootstrapApis: [],
    knowledge: [{ file: "express-4-to-5.json", fromMajor: 4, toMajor: 5 }],
  },
];

/**
 * Resolve the package family for a dependency. "react" and "react-dom" both
 * resolve to the React ecosystem; unknown packages get a single-package family.
 */
export function resolveEcosystem(dependency: string): Ecosystem {
  const name = dependency.toLowerCase();
  const known = ECOSYSTEMS.find((e) => e.packages.includes(name));
  if (known) return known;
  return {
    id: name,
    packages: [name],
    syncedPackages: [name],
    typePackages: [],
    bootstrapApis: [],
    knowledge: [],
  };
}

/**
 * Pick the knowledge base that applies to a from → to upgrade, or null.
 * Rules are only used when the target major matches the rule set's target and
 * the current major is older (or unknown).
 */
export function selectKnowledgeBase(
  eco: Ecosystem,
  fromVersion: string,
  toVersion: string
): KnowledgeBaseRef | null {
  const toMajor = parseMajor(toVersion);
  const fromMajor = parseMajor(fromVersion);
  return (
    eco.knowledge.find(
      (k) => k.toMajor === toMajor && (fromMajor === null || fromMajor < k.toMajor)
    ) ?? null
  );
}

// ---------------------------------------------------------------------------
// Minimal version helpers (no semver dependency needed for our cases)
// ---------------------------------------------------------------------------

/** "^17.0.2" → 17, "18" → 18, "unknown" → null. */
export function parseMajor(version: string): number | null {
  const m = version.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

/** "^18.3.1" → [18, 3, 1]; missing parts are null ("18" → [18, null, null]). */
export function parseVersion(version: string): [number, number | null, number | null] | null {
  const m = version.match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return null;
  return [Number(m[1]), m[2] !== undefined ? Number(m[2]) : null, m[3] !== undefined ? Number(m[3]) : null];
}

/**
 * True when `installed` (an exact version like "18.3.1") satisfies the caret
 * range "^<target>": same major, and not lower than any component the target
 * specifies ("18" accepts any 18.x).
 */
export function satisfiesCaret(installed: string, target: string): boolean {
  const i = parseVersion(installed);
  const t = parseVersion(target);
  if (!i || !t) return false;
  if (i[0] !== t[0]) return false;
  const iv = [i[0], i[1] ?? 0, i[2] ?? 0];
  const tv = [t[0], t[1] ?? 0, t[2] ?? 0];
  for (let k = 1; k < 3; k++) {
    if (iv[k] > tv[k]) return true;
    if (iv[k] < tv[k]) return false;
  }
  return true;
}

/** True when exact version `a` >= exact version `b`. */
export function versionGte(a: string, b: string): boolean {
  const av = parseVersion(a);
  const bv = parseVersion(b);
  if (!av || !bv) return false;
  for (let k = 0; k < 3; k++) {
    const x = av[k] ?? 0;
    const y = bv[k] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}
