// Stateless carrier for per-turn PII values across the Live Voice Mode relay.
// /api/ai/live/tool harvests exact PII strings from tool results
// (collectPiiValues) and returns them AES-256-GCM sealed; the client can
// neither read nor forge the seal and echoes it back to /api/ai/live/commit,
// which unseals it to mask names/addresses in the persisted assistant
// transcript — the same known-values masking the text chat does in-process.
// Bound to userId (AAD) + a short TTL so a seal can't be replayed across users.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { PiiTag } from "@/lib/ai/pii-sanitizer";

export const PII_SEAL_TTL_MS = 30 * 60_000;
export const PII_SEAL_MAX_CHARS = 16_000;

function key(secret: string): Buffer {
  return createHash("sha256").update(`smartcase:pii-seal:${secret}`).digest();
}

export function sealPii(values: ReadonlyMap<string, PiiTag>, userId: string, secret: string, now = Date.now()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  cipher.setAAD(Buffer.from(userId));
  const payload = JSON.stringify({
    exp: now + PII_SEAL_TTL_MS,
    v: [...values],
  });
  const body = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

// Returns null for anything tampered, expired, oversized, or sealed for another user.
export function unsealPii(seal: unknown, userId: string, secret: string, now = Date.now()): Map<string, PiiTag> | null {
  if (typeof seal !== "string" || seal.length > PII_SEAL_MAX_CHARS) return null;
  try {
    const raw = Buffer.from(seal, "base64url");
    if (raw.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", key(secret), raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(userId));
    decipher.setAuthTag(raw.subarray(12, 28));
    const json = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
    const parsed = JSON.parse(json) as { exp: number; v: [string, PiiTag][] };
    if (typeof parsed.exp !== "number" || parsed.exp < now || !Array.isArray(parsed.v)) return null;
    return new Map(parsed.v);
  } catch {
    return null;
  }
}
