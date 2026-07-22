import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidIsraeliId, maskPii, collectPiiValues, PII_TAGS } from "../src/lib/ai/pii-sanitizer";

test("isValidIsraeliId: checksum-valid vs invalid digit runs", () => {
  assert.equal(isValidIsraeliId("200000008"), true); // checksum-valid 9-digit
  assert.equal(isValidIsraeliId("1234566"), true); // checksum-valid 7-digit
  assert.equal(isValidIsraeliId("123456789"), false); // not a real id (case-number-like)
  assert.equal(isValidIsraeliId("200000009"), false); // one digit off from a valid id
  assert.equal(isValidIsraeliId("12345"), false); // too short
  assert.equal(isValidIsraeliId("1234567890"), false); // too long
});

test("isValidIsraeliId: all-zero digit run is rejected despite passing the checksum trivially", () => {
  assert.equal(isValidIsraeliId("0000000"), false);
  assert.equal(isValidIsraeliId("000000000"), false);
});

test("maskPii masks a checksum-valid Israeli ID and leaves invalid digit runs alone", () => {
  assert.equal(maskPii('תבדוק ת"ז 200000008'), `תבדוק ת"ז ${PII_TAGS.nationalId}`);
  assert.equal(maskPii("תיק מספר 123456789"), "תיק מספר 123456789");
  assert.equal(maskPii("קוד 0000000"), "קוד 0000000");
});

test("maskPii masks all Israeli phone formats", () => {
  for (const phone of ["050-1234567", "0501234567", "+972-50-1234567", "03-6123456"]) {
    assert.equal(maskPii(`התקשר ל-${phone} בבקשה`), `התקשר ל-${PII_TAGS.phone} בבקשה`);
  }
});

test("maskPii masks emails", () => {
  assert.equal(maskPii("צור קשר: moshe@example.co.il"), `צור קשר: ${PII_TAGS.email}`);
});

test("maskPii masks known exact values (names/addresses) via the known-values map", () => {
  const known = new Map([
    ["יוסי כהן", PII_TAGS.name],
    ["רחוב הרצל 5, תל אביב", PII_TAGS.address],
  ]);
  assert.equal(
    maskPii("הלקוח יוסי כהן גר ברחוב הרצל 5, תל אביב", known),
    `הלקוח ${PII_TAGS.name} גר ב${PII_TAGS.address}`
  );
});

test("maskPii masks once on overlapping known values (no nested/double tags)", () => {
  const known = new Map([
    ["יוסי", PII_TAGS.name],
    ["יוסי כהן", PII_TAGS.name],
  ]);
  // Longest-first ordering must consume "יוסי כהן" before the shorter "יוסי" substring matches.
  assert.equal(maskPii("שלום יוסי כהן", known), `שלום ${PII_TAGS.name}`);
});

test("maskPii leaves partial/paraphrased name fragments unmasked (documented limitation)", () => {
  const known = new Map([["יוסי כהן", PII_TAGS.name]]);
  // "כהן" alone is a substring of neither direction match — not the full known value.
  assert.equal(maskPii("מר כהן ביקש עדכון", known), "מר כהן ביקש עדכון");
});

test("maskPii returns plain text unchanged when there is no PII", () => {
  assert.equal(maskPii("מה סטטוס התיק?"), "מה סטטוס התיק?");
});

test("maskPii never throws and returns input unchanged on empty/edge input", () => {
  assert.equal(maskPii(""), "");
  assert.doesNotThrow(() => maskPii("plain text", new Map()));
});

test("collectPiiValues harvests fullName/phone/nationalId/address from tool results, skipping empty/non-string", () => {
  const collected = collectPiiValues({
    results: [
      { fullName: "יוסי כהן", phone: "050-1234567", nationalId: "200000008", addressCity: null },
      { fullName: "", phone: 12345, other: "not pii" },
    ],
  });
  assert.equal(collected.get("יוסי כהן"), PII_TAGS.name);
  assert.equal(collected.get("050-1234567"), PII_TAGS.phone);
  assert.equal(collected.get("200000008"), PII_TAGS.nationalId);
  assert.equal(collected.size, 3);
});

test("collectPiiValues never throws on null/undefined/non-object input", () => {
  assert.doesNotThrow(() => collectPiiValues(null));
  assert.doesNotThrow(() => collectPiiValues(undefined));
  assert.doesNotThrow(() => collectPiiValues("just a string"));
  assert.equal(collectPiiValues(null).size, 0);
});

test("collectPiiValues traversal is bounded and never overflows on deep/self-referential structures", () => {
  const deep: Record<string, unknown> = { fullName: "עומק כהן" };
  let cursor = deep;
  for (let i = 0; i < 50; i++) {
    const next: Record<string, unknown> = {};
    cursor.child = next;
    cursor = next;
  }
  assert.doesNotThrow(() => collectPiiValues(deep));

  const circular: Record<string, unknown> = { fullName: "מעגל לוי" };
  circular.self = circular;
  assert.doesNotThrow(() => collectPiiValues(circular));
});
