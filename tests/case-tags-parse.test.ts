import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCaseTags, deriveTagId, TAG_COLOR_PALETTE } from "@/types/case-tags";

// ─── parseCaseTags ───────────────────────────────────────────────────────────

test("parseCaseTags: malformed / non-array JSON → []", () => {
  assert.deepEqual(parseCaseTags(null), []);
  assert.deepEqual(parseCaseTags(undefined), []);
  assert.deepEqual(parseCaseTags("not an array"), []);
  assert.deepEqual(parseCaseTags({ foo: "bar" }), []);
  assert.deepEqual(parseCaseTags(42), []);
});

test("parseCaseTags: drops entries with invalid category or color", () => {
  const raw = [
    { id: "a", label: "ok", category: "URGENCY", color: TAG_COLOR_PALETTE[0], createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "b", label: "bad category", category: "NOT_REAL", color: TAG_COLOR_PALETTE[0], createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "c", label: "bad color", category: "URGENCY", color: "#000000", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "d", label: "missing fields" },
    null,
    "garbage",
  ];
  const result = parseCaseTags(raw);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "a");
});

test("parseCaseTags: valid entries round-trip untouched", () => {
  const raw = [
    { id: "DOMAIN:גיור", label: "גיור", category: "DOMAIN", color: TAG_COLOR_PALETTE[2], createdAt: "2026-01-01T00:00:00.000Z" },
  ];
  const result = parseCaseTags(raw);
  assert.deepEqual(result, raw);
});

// ─── deriveTagId ─────────────────────────────────────────────────────────────

test("deriveTagId: trims the label before deriving", () => {
  assert.equal(deriveTagId("URGENCY", "  דחוף  "), "URGENCY:דחוף");
});

test("deriveTagId: case-insensitive — matches the engine's duplicate check", () => {
  assert.equal(deriveTagId("CUSTOM", "Urgent"), deriveTagId("CUSTOM", "urgent"));
});

test("deriveTagId: stable — same category+label always yields the same id", () => {
  const id1 = deriveTagId("DOMAIN", "גיור");
  const id2 = deriveTagId("DOMAIN", "גיור");
  assert.equal(id1, id2);
  assert.equal(id1, "DOMAIN:גיור");
});

test("deriveTagId: different categories with the same label produce different ids", () => {
  assert.notEqual(deriveTagId("DOMAIN", "דחוף"), deriveTagId("URGENCY", "דחוף"));
});
