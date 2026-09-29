import { test } from "node:test";
import assert from "node:assert/strict";
import { PII_SEAL_TTL_MS, sealPii, unsealPii } from "../src/lib/ai/pii-seal";
import { PII_TAGS, type PiiTag } from "../src/lib/ai/pii-sanitizer";

const SECRET = "test-secret";
const values = new Map<string, PiiTag>([
  ["ישראל ישראלי", PII_TAGS.name],
  ["רחוב הרצל 1", PII_TAGS.address],
]);

test("seal round-trips for the same user", () => {
  assert.deepEqual(unsealPii(sealPii(values, "u1", SECRET), "u1", SECRET), values);
});

test("seal is opaque (no plaintext PII)", () => {
  const seal = sealPii(values, "u1", SECRET);
  assert.ok(!Buffer.from(seal, "base64url").toString("utf8").includes("ישראל"));
});

test("seal bound to user: another user cannot unseal", () => {
  assert.equal(unsealPii(sealPii(values, "u1", SECRET), "u2", SECRET), null);
});

test("wrong secret rejected", () => {
  assert.equal(unsealPii(sealPii(values, "u1", SECRET), "u1", "other"), null);
});

test("tampered seal rejected", () => {
  const raw = Buffer.from(sealPii(values, "u1", SECRET), "base64url");
  raw[raw.length - 1] ^= 1;
  assert.equal(unsealPii(raw.toString("base64url"), "u1", SECRET), null);
});

test("expired seal rejected", () => {
  const seal = sealPii(values, "u1", SECRET, 0);
  assert.equal(unsealPii(seal, "u1", SECRET, PII_SEAL_TTL_MS + 1), null);
  assert.deepEqual(unsealPii(seal, "u1", SECRET, PII_SEAL_TTL_MS - 1), values);
});

test("garbage and non-strings rejected without throwing", () => {
  for (const bad of [null, 42, "", "short", "!!!", "a".repeat(20_000)]) {
    assert.equal(unsealPii(bad, "u1", SECRET), null);
  }
});

test("empty map seals and unseals", () => {
  assert.equal(unsealPii(sealPii(new Map(), "u1", SECRET), "u1", SECRET)?.size, 0);
});
