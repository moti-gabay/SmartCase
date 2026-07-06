import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CASE_STATUS_LABELS,
  CASE_STATUS_COLORS,
  CASE_STATUS_DOT,
  CASE_TYPE_LABELS,
  PRIORITY_LABELS,
  DOCUMENT_STATUS_LABELS,
  DOCUMENT_TYPE_LABELS,
  LETTER_TYPE_LABELS,
  LETTER_TYPE_INSTRUCTIONS,
  PIPELINE_COLUMNS,
} from "../src/lib/constants";

test("every pipeline column has a label, color and dot", () => {
  for (const status of PIPELINE_COLUMNS) {
    assert.ok(CASE_STATUS_LABELS[status], `missing label for ${status}`);
    assert.ok(CASE_STATUS_COLORS[status], `missing color for ${status}`);
    assert.ok(CASE_STATUS_DOT[status], `missing dot for ${status}`);
  }
});

test("case status label/color/dot maps share the same keys", () => {
  const labels = Object.keys(CASE_STATUS_LABELS).sort();
  assert.deepEqual(Object.keys(CASE_STATUS_COLORS).sort(), labels);
  assert.deepEqual(Object.keys(CASE_STATUS_DOT).sort(), labels);
  assert.ok(labels.includes("CLOSED")); // CLOSED exists but is not a pipeline column
});

test("priority labels cover all four levels", () => {
  assert.deepEqual(Object.keys(PRIORITY_LABELS).sort(), ["HIGH", "LOW", "MEDIUM", "URGENT"]);
});

test("document status labels include the PENDING_UPLOAD placeholder", () => {
  for (const s of ["MISSING", "PENDING_UPLOAD", "UPLOADED_PENDING_REVIEW", "APPROVED", "REJECTED", "EXPIRED"]) {
    assert.ok(DOCUMENT_STATUS_LABELS[s], `missing document status label for ${s}`);
  }
});

test("letter type labels and instructions cover the same 7 types", () => {
  const labelKeys = Object.keys(LETTER_TYPE_LABELS).sort();
  assert.equal(labelKeys.length, 7);
  assert.deepEqual(Object.keys(LETTER_TYPE_INSTRUCTIONS).sort(), labelKeys);
});

test("case and document type label maps are non-empty", () => {
  assert.ok(Object.keys(CASE_TYPE_LABELS).length >= 10);
  assert.ok(DOCUMENT_TYPE_LABELS["MEDICAL_REPORT"]);
  assert.ok(DOCUMENT_TYPE_LABELS["NATIONAL_ID"]);
});
