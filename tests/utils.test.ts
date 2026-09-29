import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cn,
  formatDate,
  formatDatetime,
  isDateOverdue,
  calculateAge,
  isWithinDays,
  formatCurrency,
  generateCaseNumber,
} from "../src/lib/utils";

test("cn merges class names and dedupes conflicting tailwind classes", () => {
  assert.equal(cn("a", "b"), "a b");
  assert.equal(cn("a", false && "b", "c"), "a c"); // falsy values dropped
  assert.equal(cn("p-2", "p-4"), "p-4"); // tailwind-merge keeps the last
  assert.equal(cn("text-red-500", "text-blue-500"), "text-blue-500");
});

test("formatDate renders dd/MM/yyyy", () => {
  // Midday UTC so the calendar day is stable across timezones.
  assert.equal(formatDate("2026-03-15T12:00:00Z"), "15/03/2026");
});

test("formatDatetime includes date and HH:mm", () => {
  const out = formatDatetime("2026-03-15T09:05:00Z");
  assert.match(out, /^15\/03\/2026 \d{2}:\d{2}$/);
});

test("isDateOverdue: past is true, future is false", () => {
  assert.equal(isDateOverdue("2000-01-01T00:00:00Z"), true);
  assert.equal(isDateOverdue("2999-01-01T00:00:00Z"), false);
});

test("calculateAge computes whole years from a date of birth", () => {
  const tenYearsAgo = new Date(Date.now() - 10.5 * 365.25 * 24 * 60 * 60 * 1000);
  assert.equal(calculateAge(tenYearsAgo), 10);
  assert.equal(calculateAge(new Date()), 0);
});

test("isWithinDays: true inside the window or already past, false beyond it", () => {
  const day = 24 * 60 * 60 * 1000;
  assert.equal(isWithinDays(new Date(Date.now() + 10 * day), 30), true);
  assert.equal(isWithinDays(new Date(Date.now() - 5 * day), 30), true); // already past
  assert.equal(isWithinDays(new Date(Date.now() + 60 * day), 30), false);
});

test("formatCurrency formats ILS with thousands separator and no decimals", () => {
  const out = formatCurrency(8500);
  assert.ok(out.includes("8,500"), `expected grouping in "${out}"`);
  assert.ok(!out.includes(".00"), `expected no decimals in "${out}"`);
  // ILS symbol or code, depending on the ICU build.
  assert.ok(/₪|ILS/.test(out), `expected an ILS marker in "${out}"`);
});

test("generateCaseNumber matches SC-YYYY-NNNNN", () => {
  const n = generateCaseNumber();
  assert.match(n, /^SC-\d{4}-\d{5}$/);
  assert.ok(n.startsWith(`SC-${new Date().getFullYear()}-`));
});

test("toAiValidation: passes the validator shape, drops the analysis shape", async () => {
  const { toAiValidation } = await import("../src/lib/utils");
  const validator = { isValid: true, summary: "תקין", issues: [], recommendations: ["x"], documentAge: "3 חודשים" };
  assert.deepEqual(toAiValidation(validator), validator);
  // The document-analysis automation writes this into the same column.
  const analysis = { documentType: "OTHER", missingDocuments: [], courtHearingDate: null, requiresManagerAttention: false, managerNotes: null };
  assert.equal(toAiValidation(analysis), undefined);
  assert.equal(toAiValidation(null), undefined);
  assert.equal(toAiValidation({ isValid: true, summary: "s", issues: "bad", recommendations: [] }), undefined);
});
