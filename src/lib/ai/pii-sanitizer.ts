// Pure PII masking for the AI chat persistence boundary. Pattern-based
// detection covers Israeli national IDs (checksum-validated), Israeli phone
// numbers, and emails; Hebrew names/addresses cannot be pattern-detected, so
// they are masked only as exact strings harvested from the current turn's
// tool results via collectPiiValues. Selective model (see spec): user free
// text is masked before persistence (and thus before Gemini reads it back
// from history); live tool results are NOT masked in-flight; assistant text
// is masked before persistence. toolCalls.args is dropped entirely at the
// call site (route.ts) rather than masked here — partial search fragments
// can't be reliably matched without heuristics, so the constraint is to
// never persist args at all. This module must stay dependency-free and
// side-effect-free.

export const PII_TAGS = {
  nationalId: "[תז_ממוסכת]",
  phone: "[טלפון_ממוסך]",
  email: "[אימייל_ממוסך]",
  name: "[שם_ממוסך]",
  address: "[כתובת_ממוסכת]",
} as const;

export type PiiTag = (typeof PII_TAGS)[keyof typeof PII_TAGS];

// Official Israeli ID (ת"ז) check digit: pad to 9, alternate 1/2 weights,
// sum digit-sums, valid when divisible by 10. An all-zero run always sums to
// 0 (trivially "valid"), so it's excluded explicitly — no real ID is 000000000.
export function isValidIsraeliId(digits: string): boolean {
  if (!/^\d{7,9}$/.test(digits)) return false;
  if (/^0+$/.test(digits)) return false;
  const padded = digits.padStart(9, "0");
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let v = Number(padded[i]) * (i % 2 === 0 ? 1 : 2);
    if (v > 9) v -= 9;
    sum += v;
  }
  return sum % 10 === 0;
}

// Israeli phone: +972 or leading 0, then area (2/3/4/8/9 landline, 5X/7X
// mobile/VoIP), then 7 digits with optional dash/space separators. Digit
// lookarounds stop matches inside longer digit runs.
const PHONE_RE = /(?<!\d)(?:\+972[-\s]?|0)(?:5\d|7\d|[23489])[-\s]?\d{3}[-\s]?\d{4}(?!\d)/g;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// Digit runs that could be a typed ת"ז (leading zeros are often dropped,
// so 7-9 digits). Only checksum-valid runs are masked.
const ID_CANDIDATE_RE = /(?<!\d)\d{7,9}(?!\d)/g;

// Tool-result keys whose string values are PII, mapped to their mask tag.
const PII_KEY_TAGS: Record<string, PiiTag> = {
  fullName: PII_TAGS.name,
  nationalId: PII_TAGS.nationalId,
  phone: PII_TAGS.phone,
  email: PII_TAGS.email,
  address: PII_TAGS.address,
  addressCity: PII_TAGS.address,
};

const MAX_COLLECT_DEPTH = 8;

// Recursively harvest exact PII strings from a tool result into `into`
// (value → tag), bounded to MAX_COLLECT_DEPTH. Never throws; non-string/short
// values are skipped.
export function collectPiiValues(
  result: unknown,
  into: Map<string, PiiTag> = new Map(),
  depth = 0
): Map<string, PiiTag> {
  if (depth > MAX_COLLECT_DEPTH || result == null || typeof result !== "object") return into;
  if (Array.isArray(result)) {
    for (const item of result) collectPiiValues(item, into, depth + 1);
    return into;
  }
  for (const [key, value] of Object.entries(result)) {
    const tag = PII_KEY_TAGS[key];
    if (tag && typeof value === "string" && value.trim().length >= 2) {
      into.set(value.trim(), tag);
    } else if (value && typeof value === "object") {
      collectPiiValues(value, into, depth + 1);
    }
  }
  return into;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Mask PII in `text`: exact known values first (longest first, so a full
// name is masked before a substring of it), then email → phone → ID
// patterns. Ordering matters: phones are consumed before ID candidates so a
// 9-digit landline is not re-tested as an ID. Never throws — on internal
// failure the original text is returned unchanged (chat persistence must
// not break because masking failed).
export function maskPii(text: string, knownValues?: ReadonlyMap<string, PiiTag>): string {
  if (!text) return text;
  try {
    let out = text;
    if (knownValues && knownValues.size > 0) {
      const byLength = [...knownValues.keys()].sort((a, b) => b.length - a.length);
      for (const value of byLength) {
        out = out.replace(new RegExp(escapeRegExp(value), "g"), knownValues.get(value)!);
      }
    }
    out = out.replace(EMAIL_RE, PII_TAGS.email);
    out = out.replace(PHONE_RE, PII_TAGS.phone);
    out = out.replace(ID_CANDIDATE_RE, (run) => (isValidIsraeliId(run) ? PII_TAGS.nationalId : run));
    return out;
  } catch {
    return text;
  }
}
