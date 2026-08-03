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
  CASE_STEP_LABELS,
  TRANSCRIPTION_STATUS_LABELS,
  isTranscribableOnDemand,
  INTAKE_STATUS_LABELS,
} from "../src/lib/constants";
import { CASE_STEP_ORDER } from "../src/lib/portal/journey";
import type { IntakeStatus, TranscriptionStatus } from "../src/types";

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

test("every portal journey step has a Hebrew label, and no orphan labels exist", () => {
  for (const step of CASE_STEP_ORDER) {
    assert.ok(CASE_STEP_LABELS[step], `missing label for ${step}`);
  }
  assert.deepEqual(Object.keys(CASE_STEP_LABELS).sort(), [...CASE_STEP_ORDER].sort());
});

test("every transcription status has a Hebrew label, and no orphan labels exist", () => {
  const statuses: TranscriptionStatus[] = ["PENDING", "PROCESSING", "COMPLETED", "FAILED"];
  for (const status of statuses) {
    assert.ok(TRANSCRIPTION_STATUS_LABELS[status], `missing label for ${status}`);
  }
  assert.deepEqual(Object.keys(TRANSCRIPTION_STATUS_LABELS).sort(), [...statuses].sort());
});

test("isTranscribableOnDemand allows exactly the retryable transcription states", () => {
  // PENDING = not picked up yet, FAILED = retry. PROCESSING must be excluded so
  // the button can't race an in-flight run; COMPLETED needs no action.
  assert.equal(isTranscribableOnDemand("PENDING"), true);
  assert.equal(isTranscribableOnDemand("FAILED"), true);
  assert.equal(isTranscribableOnDemand("PROCESSING"), false);
  assert.equal(isTranscribableOnDemand("COMPLETED"), false);
});

test("isTranscribableOnDemand is false when there is no transcription state at all", () => {
  // Null is the no-audio case — the button must not appear.
  assert.equal(isTranscribableOnDemand(null), false);
  assert.equal(isTranscribableOnDemand(undefined), false);
  assert.equal(isTranscribableOnDemand(""), false);
});

test("every intake status has a Hebrew label, and no orphan labels exist", () => {
  const statuses: IntakeStatus[] = ["PENDING", "PROCESSING", "COMPLETED", "FAILED"];
  for (const status of statuses) {
    assert.ok(INTAKE_STATUS_LABELS[status], `missing label for ${status}`);
  }
  assert.deepEqual(Object.keys(INTAKE_STATUS_LABELS).sort(), [...statuses].sort());
});
