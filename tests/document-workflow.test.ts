import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DOCUMENT_TYPE_VALUES,
  MAX_MANAGER_NOTES_LENGTH,
  MAX_MISSING_DOCUMENTS,
  buildDocumentAnalysisPrompt,
  isDocumentType,
  parseDocumentAnalysis,
  parseHearingDate,
  type DocumentAnalysis,
} from "../src/lib/ai/document-schema";
import {
  HEARING_LOCATION,
  HEARING_TASK_TITLE,
  MISSING_DOCUMENT_DUE_DAYS,
  buildMissingDocumentTaskTitle,
  runDocumentAutomation,
  type DocumentAutomationPorts,
  type MissingDocumentTask,
} from "../src/lib/workflows/document-automation";
import { DOCUMENT_TYPE_LABELS } from "../src/lib/constants";

// ── the AI output contract ────────────────────────────────────────────────────

test("DOCUMENT_TYPE_VALUES stays in sync with the Hebrew label map", () => {
  assert.deepEqual([...DOCUMENT_TYPE_VALUES].sort(), Object.keys(DOCUMENT_TYPE_LABELS).sort());
});

test("parseDocumentAnalysis accepts a full, well-formed analysis", () => {
  const parsed = parseDocumentAnalysis(
    JSON.stringify({
      documentType: "MEDICAL_REPORT",
      missingDocuments: ["LAB_RESULTS", "PRESCRIPTION"],
      courtHearingDate: "2026-09-14",
      requiresManagerAttention: true,
      managerNotes: "  חסרה חתימת רופא  ",
    }),
  );
  assert.equal(parsed.ok, true);
  assert.ok(parsed.ok);
  assert.equal(parsed.data.documentType, "MEDICAL_REPORT");
  assert.deepEqual(parsed.data.missingDocuments, ["LAB_RESULTS", "PRESCRIPTION"]);
  assert.equal(parsed.data.courtHearingDate?.toISOString(), "2026-09-14T09:00:00.000Z");
  assert.equal(parsed.data.requiresManagerAttention, true);
  assert.equal(parsed.data.managerNotes, "חסרה חתימת רופא");
});

test("parseDocumentAnalysis strips the code fence Gemini sometimes adds anyway", () => {
  const parsed = parseDocumentAnalysis('```json\n{"documentType":"NATIONAL_ID"}\n```');
  assert.ok(parsed.ok);
  assert.equal(parsed.data.documentType, "NATIONAL_ID");
  assert.deepEqual(parsed.data.missingDocuments, []);
  assert.equal(parsed.data.courtHearingDate, null);
  assert.equal(parsed.data.requiresManagerAttention, false);
  assert.equal(parsed.data.managerNotes, null);
});

test("parseDocumentAnalysis rejects structurally unusable output", () => {
  assert.deepEqual(parseDocumentAnalysis(null), { ok: false, reason: "empty-response" });
  assert.deepEqual(parseDocumentAnalysis("   "), { ok: false, reason: "empty-response" });
  assert.deepEqual(parseDocumentAnalysis("המסמך נראה תקין"), { ok: false, reason: "invalid-json" });
  assert.deepEqual(parseDocumentAnalysis('{"documentType":'), { ok: false, reason: "invalid-json" });
  assert.deepEqual(parseDocumentAnalysis("[1,2]"), { ok: false, reason: "not-an-object" });
  assert.deepEqual(parseDocumentAnalysis("null"), { ok: false, reason: "not-an-object" });
});

test("unknown document types are dropped, not fatal — a bad enum never costs the other effects", () => {
  const parsed = parseDocumentAnalysis(
    JSON.stringify({
      documentType: "FOO",
      missingDocuments: ["LAB_RESULTS", "FOO", 42, null, "LAB_RESULTS"],
      requiresManagerAttention: true,
    }),
  );
  assert.ok(parsed.ok);
  assert.equal(parsed.data.documentType, "OTHER");
  // deduped, and the junk is gone
  assert.deepEqual(parsed.data.missingDocuments, ["LAB_RESULTS"]);
  assert.equal(parsed.data.requiresManagerAttention, true);
});

test("missingDocuments is capped so a hallucinating model cannot bury the agent", () => {
  const parsed = parseDocumentAnalysis(
    JSON.stringify({ documentType: "OTHER", missingDocuments: DOCUMENT_TYPE_VALUES }),
  );
  assert.ok(parsed.ok);
  assert.equal(parsed.data.missingDocuments.length, MAX_MISSING_DOCUMENTS);
});

test("managerNotes is trimmed to a bounded length", () => {
  const parsed = parseDocumentAnalysis(
    JSON.stringify({ documentType: "OTHER", managerNotes: "א".repeat(5000) }),
  );
  assert.ok(parsed.ok);
  assert.equal(parsed.data.managerNotes?.length, MAX_MANAGER_NOTES_LENGTH);
});

test("a non-array missingDocuments never costs the other two automations", () => {
  for (const raw of [null, "LAB_RESULTS", 42, { LAB_RESULTS: true }]) {
    const parsed = parseDocumentAnalysis(
      JSON.stringify({
        documentType: "OTHER",
        missingDocuments: raw,
        courtHearingDate: "2026-09-14",
        requiresManagerAttention: true,
      }),
    );
    assert.ok(parsed.ok, `expected ok for missingDocuments=${JSON.stringify(raw)}`);
    assert.deepEqual(parsed.data.missingDocuments, []);
    // the siblings in the same payload survive intact
    assert.equal(parsed.data.courtHearingDate?.toISOString(), "2026-09-14T09:00:00.000Z");
    assert.equal(parsed.data.requiresManagerAttention, true);
  }
});

test("requiresManagerAttention only accepts a real boolean true", () => {
  for (const raw of ["true", 1, "yes", null, undefined]) {
    const parsed = parseDocumentAnalysis(JSON.stringify({ documentType: "OTHER", requiresManagerAttention: raw }));
    assert.ok(parsed.ok);
    assert.equal(parsed.data.requiresManagerAttention, false, `expected false for ${JSON.stringify(raw)}`);
  }
});

test("parseHearingDate accepts only real dates and never guesses", () => {
  assert.equal(parseHearingDate("2026-09-14")?.toISOString(), "2026-09-14T09:00:00.000Z");
  assert.equal(parseHearingDate("2026-09-14T11:30:00.000Z")?.toISOString(), "2026-09-14T11:30:00.000Z");
  for (const raw of ["soon", "בקרוב", "14/09/2026", "2026-09", "2026-13-40", "", null, 20260914]) {
    assert.equal(parseHearingDate(raw), null, `expected null for ${JSON.stringify(raw)}`);
  }
});

test("isDocumentType guards every schema enum value and nothing else", () => {
  for (const value of DOCUMENT_TYPE_VALUES) assert.equal(isDocumentType(value), true);
  for (const value of ["national_id", "FOO", "", 1, null]) assert.equal(isDocumentType(value), false);
});

test("the prompt pins the JSON shape and forbids inventing a hearing date", () => {
  const prompt = buildDocumentAnalysisPrompt("דו״ח רפואי");
  assert.match(prompt, /דו״ח רפואי/);
  assert.match(prompt, /"missingDocuments"/);
  assert.match(prompt, /"courtHearingDate"/);
  assert.match(prompt, /"requiresManagerAttention"/);
  assert.match(prompt, /אין לנחש ואין להמציא/);
  for (const value of DOCUMENT_TYPE_VALUES) assert.ok(prompt.includes(value), `prompt omits ${value}`);
});

// ── the fan-out engine ────────────────────────────────────────────────────────

const NOW = new Date("2026-08-03T10:00:00.000Z");
const FUTURE = new Date("2026-09-14T09:00:00.000Z");
const PAST = new Date("2026-01-05T09:00:00.000Z");

interface Recorded {
  openTitleLookups: string[];
  createdTasks: { caseId: string; tasks: MissingDocumentTask[] }[];
  hearings: { caseId: string; startsAt: Date }[];
  flags: { caseId: string; title: string; notes: string }[];
}

function analysis(overrides: Partial<DocumentAnalysis> = {}): DocumentAnalysis {
  return {
    documentType: "MEDICAL_REPORT",
    missingDocuments: [],
    courtHearingDate: null,
    requiresManagerAttention: false,
    managerNotes: null,
    ...overrides,
  };
}

function fakePorts(
  openTitles: string[] = [],
  fail: Partial<Record<"tasks" | "hearing" | "manager", string>> = {},
): { ports: DocumentAutomationPorts; recorded: Recorded } {
  const recorded: Recorded = { openTitleLookups: [], createdTasks: [], hearings: [], flags: [] };
  const ports: DocumentAutomationPorts = {
    listOpenTaskTitles: async (caseId) => {
      recorded.openTitleLookups.push(caseId);
      return openTitles;
    },
    createMissingDocumentTasks: async (caseId, tasks) => {
      if (fail.tasks) throw new Error(fail.tasks);
      recorded.createdTasks.push({ caseId, tasks });
      return tasks.length;
    },
    scheduleHearing: async (caseId, startsAt) => {
      if (fail.hearing) throw new Error(fail.hearing);
      recorded.hearings.push({ caseId, startsAt });
    },
    flagManagerAttention: async (caseId, title, notes) => {
      if (fail.manager) throw new Error(fail.manager);
      recorded.flags.push({ caseId, title, notes });
    },
  };
  return { ports, recorded };
}

function run(a: DocumentAnalysis, ports: DocumentAutomationPorts) {
  return runDocumentAutomation({ caseId: "case-1", documentName: "דו״ח רפואי", analysis: a, now: NOW }, ports);
}

test("full fan-out: all three effects fire from one analysis", async () => {
  const { ports, recorded } = fakePorts();
  const result = await run(
    analysis({
      missingDocuments: ["LAB_RESULTS", "PRESCRIPTION"],
      courtHearingDate: FUTURE,
      requiresManagerAttention: true,
      managerNotes: "סתירה בתאריכים",
    }),
    ports,
  );

  assert.equal(result.tasksCreated, 2);
  assert.equal(result.hearingScheduledAt?.toISOString(), FUTURE.toISOString());
  assert.equal(result.managerFlagged, true);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.skipped, []);

  assert.deepEqual(recorded.hearings, [{ caseId: "case-1", startsAt: FUTURE }]);
  assert.equal(recorded.flags[0].notes, "סתירה בתאריכים");
  assert.match(recorded.flags[0].title, /דו״ח רפואי/);

  const titles = recorded.createdTasks[0].tasks.map((t) => t.title);
  assert.deepEqual(titles, [
    buildMissingDocumentTaskTitle("LAB_RESULTS"),
    buildMissingDocumentTaskTitle("PRESCRIPTION"),
  ]);
  const expectedDue = new Date(NOW.getTime() + MISSING_DOCUMENT_DUE_DAYS * 86_400_000);
  assert.equal(recorded.createdTasks[0].tasks[0].dueDate.toISOString(), expectedDue.toISOString());
});

test("empty analysis performs no reads and no writes at all", async () => {
  const { ports, recorded } = fakePorts();
  const result = await run(analysis(), ports);

  assert.deepEqual(result, {
    tasksCreated: 0,
    hearingScheduledAt: null,
    managerFlagged: false,
    skipped: [],
    failures: [],
  });
  assert.deepEqual(recorded.openTitleLookups, []);
  assert.deepEqual(recorded.createdTasks, []);
  assert.deepEqual(recorded.hearings, []);
  assert.deepEqual(recorded.flags, []);
});

test("a hearing date in the past is skipped while the other effects still run", async () => {
  const { ports, recorded } = fakePorts();
  const result = await run(
    analysis({ courtHearingDate: PAST, missingDocuments: ["NATIONAL_ID"], requiresManagerAttention: true }),
    ports,
  );

  assert.equal(result.hearingScheduledAt, null);
  assert.deepEqual(recorded.hearings, []);
  assert.deepEqual(result.skipped, ["hearing-date-in-past"]);
  assert.equal(result.tasksCreated, 1);
  assert.equal(result.managerFlagged, true);
  assert.deepEqual(result.failures, []);
});

test("re-running on the same case does not duplicate an already-open task", async () => {
  const { ports, recorded } = fakePorts([buildMissingDocumentTaskTitle("LAB_RESULTS")]);
  const result = await run(analysis({ missingDocuments: ["LAB_RESULTS", "PRESCRIPTION"] }), ports);

  assert.equal(result.tasksCreated, 1);
  assert.deepEqual(result.skipped, ["task-already-open:LAB_RESULTS"]);
  assert.deepEqual(
    recorded.createdTasks[0].tasks.map((t) => t.documentType),
    ["PRESCRIPTION"],
  );
});

test("when every missing document is already tracked, nothing is written", async () => {
  const { ports, recorded } = fakePorts([buildMissingDocumentTaskTitle("LAB_RESULTS")]);
  const result = await run(analysis({ missingDocuments: ["LAB_RESULTS"] }), ports);

  assert.equal(result.tasksCreated, 0);
  assert.deepEqual(recorded.createdTasks, []);
  assert.deepEqual(result.skipped, ["task-already-open:LAB_RESULTS"]);
});

test("a failing branch is reported, never thrown, and never blocks its siblings", async () => {
  const { ports, recorded } = fakePorts([], { tasks: "unique constraint" });
  const result = await run(
    analysis({
      missingDocuments: ["LAB_RESULTS"],
      courtHearingDate: FUTURE,
      requiresManagerAttention: true,
      managerNotes: "דחוף",
    }),
    ports,
  );

  assert.deepEqual(result.failures, [{ effect: "tasks", reason: "unique constraint" }]);
  assert.equal(result.tasksCreated, 0);
  // the siblings committed regardless
  assert.equal(result.hearingScheduledAt?.toISOString(), FUTURE.toISOString());
  assert.equal(result.managerFlagged, true);
  assert.equal(recorded.hearings.length, 1);
  assert.equal(recorded.flags.length, 1);
});

test("every branch failing still resolves with a full failure report", async () => {
  const { ports } = fakePorts([], { tasks: "t", hearing: "h", manager: "m" });
  const result = await run(
    analysis({ missingDocuments: ["NATIONAL_ID"], courtHearingDate: FUTURE, requiresManagerAttention: true }),
    ports,
  );

  assert.deepEqual(result.failures.map((f) => f.effect).sort(), ["hearing", "manager", "tasks"]);
  assert.equal(result.tasksCreated, 0);
  assert.equal(result.hearingScheduledAt, null);
  assert.equal(result.managerFlagged, false);
});

test("a manager flag with no notes still carries an explanation into the task", async () => {
  const { ports, recorded } = fakePorts();
  const result = await run(analysis({ requiresManagerAttention: true, managerNotes: null }), ports);

  assert.equal(result.managerFlagged, true);
  assert.ok(recorded.flags[0].notes.length > 0);
});

test("task titles are derived from the enum's Hebrew label, never from AI prose", () => {
  assert.equal(buildMissingDocumentTaskTitle("LAB_RESULTS"), `להשלים מסמך: ${DOCUMENT_TYPE_LABELS.LAB_RESULTS}`);
  assert.equal(HEARING_LOCATION, "בית דין");
  assert.equal(HEARING_TASK_TITLE, "דיון בבית דין");
});

// End-to-end through the contract: raw model text → validated analysis → effects.
test("raw Gemini text flows through the schema into the exact effects it implies", async () => {
  const parsed = parseDocumentAnalysis(
    '```json\n{"documentType":"AUTHORITY_DECISION_LETTER","missingDocuments":["APPEAL_LETTER","NOPE"],' +
      '"courtHearingDate":"2026-09-14","requiresManagerAttention":true,"managerNotes":"נדחה — יש להגיש ערעור"}\n```',
  );
  assert.ok(parsed.ok);

  const { ports, recorded } = fakePorts();
  const result = await run(parsed.data, ports);

  assert.equal(result.tasksCreated, 1);
  assert.deepEqual(recorded.createdTasks[0].tasks.map((t) => t.documentType), ["APPEAL_LETTER"]);
  assert.equal(result.hearingScheduledAt?.toISOString(), "2026-09-14T09:00:00.000Z");
  assert.equal(recorded.flags[0].notes, "נדחה — יש להגיש ערעור");
  assert.deepEqual(result.failures, []);
});
