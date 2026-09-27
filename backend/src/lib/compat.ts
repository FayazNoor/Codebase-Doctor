/**
 * Peer-dependency compatibility preflight.
 *
 * The most common reason a React 17 → 18 upgrade fails is not source code but
 * a library whose peerDependencies exclude React 18 (react-redux@5,
 * @testing-library/react@12, enzyme adapters …): npm ≥ 7 refuses the install
 * with ERESOLVE. This module finds those packages BEFORE anything is changed,
 * so the plan can upgrade well-known companions and flag the rest for a human.
 *
 * Sources, in order of precision:
 *   1. package-lock.json v2/v3 — exact resolved versions and their peer ranges (offline)
 *   2. node_modules/<pkg>/package.json — when the repo has been installed (offline)
 *   3. npm registry — the newest release matching each declared range (network;
 *      skipped when CODEBASE_DOCTOR_OFFLINE=1)
 *   4. a small curated list of known companions (offline)
 */

import fs from "node:fs";
import path from "node:path";
import semver from "semver";
import { companionsFor, type Ecosystem } from "./ecosystem.js";
import type { CompatReport, PeerConflict } from "../types.js";

// ---------------------------------------------------------------------------
// Registry access (injectable for tests)
// ---------------------------------------------------------------------------

/** Abbreviated npm packument: just versions and their peer ranges. */
export interface Packument {
  versions: Record<string, { peerDependencies?: Record<string, string>; deprecated?: string }>;
}
export type RegistryFetcher = (name: string) => Promise<Packument | null>;

const REGISTRY_TIMEOUT_MS = 8_000;

const defaultFetcher: RegistryFetcher = async (name) => {
  const registry = (process.env["npm_config_registry"] || "https://registry.npmjs.org/").replace(/\/?$/, "/");
  try {
    const res = await fetch(`${registry}${name.replace("/", "%2F")}`, {
      headers: { Accept: "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8" },
      signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as Packument;
  } catch {
    return null;
  }
};

let fetcher: RegistryFetcher = defaultFetcher;

/** Override registry lookups (tests). Pass null to restore the default. */
export function setRegistryFetcher(f: RegistryFetcher | null): void {
  fetcher = f ?? defaultFetcher;
}

export function isOffline(): boolean {
  return /^(1|true|yes)$/i.test(process.env["CODEBASE_DOCTOR_OFFLINE"] ?? "");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type PkgJson = { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

/** Concrete version the target resolves to for peer checks: "18" → 18.0.0, "^18.3.1" → 18.3.1. */
export function targetVersionFor(toVersion: string): string | null {
  return semver.minVersion(/^[\^~<>=]/.test(toVersion) ? toVersion : `^${toVersion}`)?.version ?? semver.coerce(toVersion)?.version ?? null;
}

function peerAccepts(range: string, version: string): boolean {
  try {
    return semver.satisfies(version, range, { includePrerelease: true });
  } catch {
    return true; // unparseable ranges are not reported as conflicts
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Lowest published version newer than `current` whose peer range for `peer` accepts `target`. */
export function lowestCompatible(p: Packument, peer: string, target: string, current: string | null): string | null {
  const candidates = Object.keys(p.versions)
    .filter((v) => semver.valid(v) && !semver.prerelease(v) && !p.versions[v].deprecated)
    .filter((v) => !current || !semver.valid(current) || semver.gt(v, current))
    .sort(semver.compare);
  for (const v of candidates) {
    const range = p.versions[v].peerDependencies?.[peer];
    if (range === undefined || peerAccepts(range, target)) return v;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Target version existence
// ---------------------------------------------------------------------------

export interface TargetCheck {
  /** False when the registry could not be asked (offline / unreachable). */
  checked: boolean;
  exists: boolean;
  /** Newest published stable version with the target's major, if any. */
  newestInMajor: string | null;
  /** Newest published stable version overall. */
  newest: string | null;
}

/** Does any published version of `name` satisfy the upgrade target ("18.3.1" → ^18.3.1)? */
export async function checkTargetExists(name: string, toVersion: string): Promise<TargetCheck> {
  if (isOffline()) return { checked: false, exists: false, newestInMajor: null, newest: null };
  const p = await fetcher(name);
  if (!p) return { checked: false, exists: false, newestInMajor: null, newest: null };
  const versions = Object.keys(p.versions).filter((v) => semver.valid(v));
  const range = /^[\^~<>=]/.test(toVersion) ? toVersion : `^${toVersion}`;
  const stable = versions.filter((v) => !semver.prerelease(v)).sort(semver.rcompare);
  const major = semver.minVersion(range)?.major ?? null;
  return {
    checked: true,
    exists: semver.maxSatisfying(versions, range, { includePrerelease: /-/.test(toVersion) }) !== null,
    newestInMajor: stable.find((v) => semver.major(v) === major) ?? null,
    newest: stable[0] ?? null,
  };
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export interface CompatInput {
  repoPath: string;
  ecosystem: Ecosystem;
  toVersion: string;
}

export async function checkPeerCompatibility(input: CompatInput): Promise<CompatReport> {
  const { repoPath, ecosystem } = input;
  const target = targetVersionFor(input.toVersion);
  const pkgPath = path.join(repoPath, "package.json");
  if (!target || !fs.existsSync(pkgPath)) {
    return { checked: false, method: "none", packagesChecked: 0, conflicts: [], note: "No package.json or unparseable target version." };
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as PkgJson;
  const sectionOf = (name: string): PeerConflict["section"] =>
    pkg.dependencies?.[name] !== undefined ? "dependencies" : pkg.devDependencies?.[name] !== undefined ? "devDependencies" : null;
  const declared = new Map<string, string>([
    ...Object.entries(pkg.devDependencies ?? {}),
    ...Object.entries(pkg.dependencies ?? {}),
  ]);

  // Packages the dependency step itself moves to the target — their old peer ranges are irrelevant.
  const upgradedTogether = new Set([...ecosystem.packages, ...ecosystem.syncedPackages, ...ecosystem.typePackages]);
  const peersOfInterest = new Set([...ecosystem.packages, ...ecosystem.syncedPackages]);

  const companions = companionsFor(ecosystem, input.toVersion);
  const conflicts = new Map<string, PeerConflict>();
  const covered = new Set<string>();
  const methods: string[] = [];
  const notes: string[] = [];

  const consider = (name: string, version: string, peers: Record<string, string> | undefined, source: PeerConflict["source"]) => {
    if (upgradedTogether.has(name) || !peers) return;
    for (const [peer, range] of Object.entries(peers)) {
      if (!peersOfInterest.has(peer)) continue;
      if (!peerAccepts(range, target) && !conflicts.has(name)) {
        conflicts.set(name, { name, version, section: sectionOf(name), peer, range, source, suggestion: null, autoUpgrade: false });
      }
    }
  };

  // 1. npm lockfile v2/v3
  const lockPath = path.join(repoPath, "package-lock.json");
  if (fs.existsSync(lockPath)) {
    try {
      const lock = JSON.parse(fs.readFileSync(lockPath, "utf8")) as {
        lockfileVersion?: number;
        packages?: Record<string, { version?: string; peerDependencies?: Record<string, string>; peerDependenciesMeta?: Record<string, { optional?: boolean }> }>;
      };
      if ((lock.lockfileVersion ?? 1) >= 2 && lock.packages) {
        methods.push(`package-lock.json (lockfileVersion ${lock.lockfileVersion})`);
        for (const [key, entry] of Object.entries(lock.packages)) {
          const idx = key.lastIndexOf("node_modules/");
          if (idx === -1) continue;
          const name = key.slice(idx + "node_modules/".length);
          const required = Object.fromEntries(
            Object.entries(entry.peerDependencies ?? {}).filter(([p]) => !entry.peerDependenciesMeta?.[p]?.optional)
          );
          consider(name, entry.version ?? "?", required, "lockfile");
          if (key === `node_modules/${name}`) covered.add(name);
        }
      } else {
        notes.push("package-lock.json v1 does not record peer ranges");
      }
    } catch {
      notes.push("package-lock.json could not be parsed");
    }
  }

  // 2. installed node_modules
  if (fs.existsSync(path.join(repoPath, "node_modules"))) {
    let used = false;
    for (const name of declared.keys()) {
      if (covered.has(name)) continue;
      const p = path.join(repoPath, "node_modules", name, "package.json");
      if (!fs.existsSync(p)) continue;
      const m = JSON.parse(fs.readFileSync(p, "utf8")) as { version?: string; peerDependencies?: Record<string, string> };
      consider(name, m.version ?? "?", m.peerDependencies, "node_modules");
      covered.add(name);
      used = true;
    }
    if (used) methods.push("node_modules");
  }

  // 3. npm registry for declared packages not covered yet
  const packuments = new Map<string, Packument | null>();
  const uncovered = [...declared.keys()].filter((n) => !covered.has(n) && !upgradedTogether.has(n));
  if (uncovered.length > 0) {
    if (isOffline()) {
      notes.push(`offline — ${uncovered.length} declared package(s) not checked against the npm registry`);
    } else {
      const results = await mapLimit(uncovered, 8, async (name) => [name, await fetcher(name)] as const);
      let resolved = 0;
      for (const [name, p] of results) {
        packuments.set(name, p);
        const range = declared.get(name)!;
        const version = p ? semver.maxSatisfying(Object.keys(p.versions), range) : null;
        if (!p || !version) continue;
        consider(name, version, p.versions[version].peerDependencies, "registry");
        covered.add(name);
        resolved++;
      }
      if (resolved > 0) methods.push(`npm registry (newest release matching each declared range, ${resolved} package(s))`);
      if (resolved < uncovered.length) notes.push(`${uncovered.length - resolved} package(s) could not be resolved on the registry`);
    }
  }

  // 4. curated known companions (also covers repos with no lockfile and no network)
  for (const known of companions) {
    const range = declared.get(known.name);
    if (range === undefined) continue;
    const min = semver.validRange(range) ? semver.minVersion(range)?.version ?? null : null;
    const supported = known.supportsFrom !== null && min !== null && semver.gte(min, known.supportsFrom);
    const existing = conflicts.get(known.name);
    if (!existing && !supported && !covered.has(known.name)) {
      conflicts.set(known.name, {
        name: known.name,
        version: range,
        section: sectionOf(known.name),
        peer: ecosystem.packages[0],
        range: known.supportsFrom ? `< ${known.supportsFrom} (known: needs ≥ ${known.supportsFrom})` : "no compatible release",
        source: "known",
        suggestion: null,
        autoUpgrade: false,
      });
    }
    const c = conflicts.get(known.name);
    if (c) {
      c.suggestion = known.upgradeTo;
      c.autoUpgrade = known.upgradeTo !== null && c.section !== null;
      if (known.note) c.range = `${c.range} — ${known.note}`;
    }
  }

  // Suggest the lowest compatible release for the rest (registry only).
  const needSuggestion = [...conflicts.values()].filter((c) => c.suggestion === null && !companions.some((k) => k.name === c.name));
  if (needSuggestion.length > 0 && !isOffline()) {
    await mapLimit(needSuggestion, 4, async (c) => {
      const p = packuments.has(c.name) ? packuments.get(c.name)! : await fetcher(c.name);
      if (!p) return;
      const current = semver.valid(c.version) ? c.version : semver.minVersion(c.version)?.version ?? null;
      const v = lowestCompatible(p, c.peer, target, current);
      if (v) c.suggestion = `^${v}`;
    });
  }

  const checked = methods.length > 0 || companions.some((k) => declared.has(k.name));
  return {
    checked,
    method: methods.length > 0 ? methods.join(" + ") : checked ? "known companions only" : "none",
    packagesChecked: covered.size,
    conflicts: [...conflicts.values()].sort((a, b) => a.name.localeCompare(b.name)),
    note: notes.length > 0 ? notes.join("; ") : null,
  };
}
