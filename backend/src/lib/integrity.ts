/**
 * Tamper-evident session state.
 *
 * Every state file the tools write (session, analysis, requirements, plan,
 * checks) carries an HMAC-SHA256 `_seal` computed with a per-installation key
 * stored at <home>/integrity.key. Reads verify the seal, so a state file that
 * was edited or hand-written outside the tools — e.g. a "reconstructed"
 * checks-result.json claiming verification passed, or a step status flipped
 * to "applied" — is rejected instead of being reported as real.
 *
 * This is tamper-EVIDENCE for the approval/verification record, not a
 * security boundary: a local actor who reads the key can still forge a seal,
 * but cannot do so by accident or by "fixing up" a JSON file.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const SEAL_FIELD = "_seal";

export class IntegrityError extends Error {
  constructor(readonly file: string, reason: string) {
    super(
      `Integrity check failed for ${path.basename(file)} (${reason}): the file was modified or written outside ` +
        `Codebase Doctor's tools, so its contents are not trusted. Re-run the tool that produces it ` +
        `(verify_migration rewrites checks-result.json), or start a new session with analyze_dependency_usage.`
    );
    this.name = "IntegrityError";
  }
}

const keyCache = new Map<string, Buffer>();

/** Read (or create on first use) the installation's sealing key. */
export function integrityKey(home: string): Buffer {
  const cached = keyCache.get(home);
  if (cached) return cached;
  const file = path.join(home, "integrity.key");
  fs.mkdirSync(home, { recursive: true });
  if (!fs.existsSync(file)) {
    try {
      fs.writeFileSync(file, crypto.randomBytes(32).toString("hex"), { mode: 0o600, flag: "wx" });
    } catch (err) {
      // Another process created it first — fall through and read theirs.
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
  const key = Buffer.from(fs.readFileSync(file, "utf8").trim(), "hex");
  if (key.length < 32) throw new Error(`${file} is corrupt (expected 32 random bytes as hex). Delete it to regenerate.`);
  keyCache.set(home, key);
  return key;
}

function mac(key: Buffer, body: unknown): string {
  return crypto.createHmac("sha256", key).update(JSON.stringify(body)).digest("hex");
}

/** Return a copy of `data` with a `_seal` over its JSON form. */
export function sealed<T extends object>(key: Buffer, data: T): T & { _seal: string } {
  const { [SEAL_FIELD]: _drop, ...body } = data as Record<string, unknown>;
  void _drop;
  return { ...(body as T), [SEAL_FIELD]: mac(key, body) } as T & { _seal: string };
}

/** Verify and strip the seal. Throws IntegrityError when it is missing or wrong. */
export function unseal<T>(key: Buffer, file: string, parsed: unknown): T {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new IntegrityError(file, "not a JSON object");
  }
  const { [SEAL_FIELD]: seal, ...body } = parsed as Record<string, unknown>;
  if (typeof seal !== "string") throw new IntegrityError(file, "no seal");
  const expected = mac(key, body);
  const ok = seal.length === expected.length && crypto.timingSafeEqual(Buffer.from(seal), Buffer.from(expected));
  if (!ok) throw new IntegrityError(file, "seal mismatch");
  return body as T;
}
