import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INTAKE_GAP_LABELS,
  INTAKE_GAP_VALUES,
  buildStoryIntakePrompt,
  parseStoryIntake,
  type StoryIntake,
} from "../src/lib/ai/story-intake-schema";
import {
  INTAKE_GAP_DUE_DAYS,
  INTAKE_MANAGER_TASK_TITLE,
  addDays,
  buildIntakeGapTaskTitle,
  runStoryIntake,
  type IntakeGapTask,
  type StoryIntakePorts,
} from "../src/lib/workflows/story-intake";
import { INTAKE_STATUS_LABELS } from "../src/lib/constants";

// ── the intake schema ─────────────────────────────────────────────────────────

test("every intake gap has a Hebrew label", () => {
  assert.deepEqual([...INTAKE_GAP_VALUES].sort(), Object.keys(INTAKE_GAP_LABELS).sort());
});

test("every intake status has a Hebrew label", () => {
  assert.deepEqual(
    ["PENDING", "PROCESSING", "COMPLETED", "FAILED"].sort(),
    Object.keys(INTAKE_STATUS_LABELS).sort(),
  );
});

test("malformed AI output is rejected with a reason, never thrown", () => {
  assert.deepEqual(parseStoryIntake(""), { ok: false, reason: "empty-response" });
  assert.deepEqual(parseStoryIntake("   "), { ok: false, reason: "empty-response" });
  assert.deepEqual(parseStoryIntake(null), { ok: false, reason: "empty-response" });
  assert.deepEqual(parseStoryIntake("not json"), { ok: false, reason: "invalid-json" });
  assert.deepEqual(parseStoryIntake("[1,2]"), { ok: false, reason: "not-an-object" });
  assert.deepEqual(parseStoryIntake("null"), { ok: false, reason: "not-an-object" });
});

test("hallucinated fields are dropped, not fatal", () => {
  const parsed = parseStoryIntake(
    JSON.stringify({
      gaps: ["MISSING_MOTIVATION", "NOT_A_GAP", 7, "MISSING_MOTIVATION"],
      hasRedFlags: "yes",
      mentionedPeople: "לא מערך",
      motivationSummary: "רוצה להצטרף לעם ישראל",
    }),
  );
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.data.gaps, ["MISSING_MOTIVATION"]);
  assert.equal(parsed.data.hasRedFlags, false);
  assert.deepEqual(parsed.data.mentionedPeople, []);
  // the sibling field in the same payload survives intact
  assert.equal(parsed.data.motivationSummary, "רוצה להצטרף לעם ישראל");
});

test("free text is trimmed, capped, and empty becomes null", () => {
  const parsed = parseStoryIntake(
    JSON.stringify({
      motivationSummary: "א".repeat(2000),
      processDuration: "   ",
      familyStatus: "  נשוי + 2  ",
    }),
  );
  assert.ok(parsed.ok);
  assert.equal(parsed.data.motivationSummary?.length, 600);
  assert.equal(parsed.data.processDuration, null);
  assert.equal(parsed.data.familyStatus, "נשוי + 2");
});

test("gaps are deduped and capped", () => {
  const parsed = parseStoryIntake(
    JSON.stringify({ gaps: [...INTAKE_GAP_VALUES, ...INTAKE_GAP_VALUES] }),
  );
  assert.ok(parsed.ok);
  assert.equal(parsed.data.gaps.length, 5);
  assert.equal(new Set(parsed.data.gaps).size, parsed.data.gaps.length);
});

test("the prompt names every allowed gap and forbids extra fields", () => {
  const prompt = buildStoryIntakePrompt("סיפור התמלול כאן");
  for (const gap of INTAKE_GAP_VALUES) assert.ok(prompt.includes(gap), `prompt omits ${gap}`);
  assert.match(prompt, /אין להוסיף שדות/);
  assert.match(prompt, /סיפור התמלול כאן/);
});

// ── the fan-out engine ────────────────────────────────────────────────────────

const NOW = new Date("2026-08-03T10:00:00.000Z");

function intake(overrides: Partial<StoryIntake> = {}): StoryIntake {
  return {
    motivationSummary: null,
    processDuration: null,
    familyStatus: null,
    communityAffiliation: null,
    mentionedDocuments: [],
    mentionedPeople: [],
    gaps: [],
    hasRedFlags: false,
    redFlagNotes: null,
    ...overrides,
  };
}

interface Recorded {
  tasks: IntakeGapTask[];
  managerNotes: (string | null)[];
  saved: { intake: StoryIntake; at: Date }[];
  openTitlesReads: string[];
}

function makePorts(
  overrides: Partial<StoryIntakePorts> = {},
  openTitles: string[] = [],
): { ports: StoryIntakePorts; rec: Recorded } {
  const rec: Recorded = { tasks: [], managerNotes: [], saved: [], openTitlesReads: [] };
  const ports: StoryIntakePorts = {
    listOpenTaskTitles: async (caseId) => {
      rec.openTitlesReads.push(caseId);
      return openTitles;
    },
    createTasks: async (_caseId, tasks) => {
      rec.tasks.push(...tasks);
      return tasks.length;
    },
    flagForManager: async (_caseId, notes) => {
      rec.managerNotes.push(notes);
    },
    saveIntake: async (_caseId, data, at) => {
      rec.saved.push({ intake: data, at });
    },
    logError: () => {},
    ...overrides,
  };
  return { ports, rec };
}

const run = (data: StoryIntake, ports: StoryIntakePorts, now: Date = NOW) =>
  runStoryIntake({ caseId: "case-1", intake: data, now }, ports);

test("a full intake saves, opens one task per gap, and escalates red flags", async () => {
  const { ports, rec } = makePorts();
  const gaps = ["MISSING_RABBI", "MISSING_DOCUMENTS"] as const;
  const result = await run(
    intake({
      gaps: [...gaps],
      mentionedDocuments: ["תעודת לידה"],
      hasRedFlags: true,
      redFlagNotes: "לחץ מצד המשפחה",
    }),
    ports,
  );

  assert.equal(result.saved, true);
  assert.equal(result.tasksCreated, 2);
  assert.equal(result.managerFlagged, true);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.skipped, []);

  assert.deepEqual(rec.tasks.map((t) => t.title), gaps.map(buildIntakeGapTaskTitle));
  const expectedDue = addDays(NOW, INTAKE_GAP_DUE_DAYS);
  for (const task of rec.tasks) assert.equal(task.dueDate.toISOString(), expectedDue.toISOString());
  // only the document gap carries the extracted list
  assert.match(rec.tasks[1].description, /תעודת לידה/);
  assert.doesNotMatch(rec.tasks[0].description, /תעודת לידה/);
  assert.deepEqual(rec.managerNotes, ["לחץ מצד המשפחה"]);
  assert.equal(rec.saved[0].at.toISOString(), NOW.toISOString());
});

test("re-running on the same case does not duplicate an already-open task", async () => {
  const { ports, rec } = makePorts({}, [buildIntakeGapTaskTitle("MISSING_RABBI")]);
  const result = await run(intake({ gaps: ["MISSING_RABBI", "MISSING_COMMUNITY"] }), ports);

  assert.equal(result.tasksCreated, 1);
  assert.deepEqual(result.skipped, ["task-already-open:MISSING_RABBI"]);
  assert.deepEqual(rec.tasks.map((t) => t.title), [buildIntakeGapTaskTitle("MISSING_COMMUNITY")]);
});

test("an intake whose gaps are all already open creates no task at all", async () => {
  const { ports, rec } = makePorts(
    {
      createTasks: async () => {
        throw new Error("createTasks must not be called");
      },
    },
    [buildIntakeGapTaskTitle("MISSING_RABBI")],
  );
  const result = await run(intake({ gaps: ["MISSING_RABBI"] }), ports);

  assert.equal(result.tasksCreated, 0);
  assert.deepEqual(rec.tasks, []);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.skipped, ["task-already-open:MISSING_RABBI"]);
});

test("red flags without notes still escalate and are recorded as skipped", async () => {
  const { ports, rec } = makePorts();
  const result = await run(intake({ hasRedFlags: true, redFlagNotes: null }), ports);

  assert.equal(result.managerFlagged, true);
  assert.deepEqual(rec.managerNotes, [null]);
  assert.ok(result.skipped.includes("manager-notes-missing"));
});

test("an intake with no gaps and no red flags performs zero task and manager work", async () => {
  const boom = (name: string) => async () => {
    throw new Error(`${name} must not be called`);
  };
  const { ports, rec } = makePorts({
    listOpenTaskTitles: boom("listOpenTaskTitles") as StoryIntakePorts["listOpenTaskTitles"],
    createTasks: boom("createTasks") as StoryIntakePorts["createTasks"],
    flagForManager: boom("flagForManager") as StoryIntakePorts["flagForManager"],
  });
  const result = await run(intake(), ports);

  assert.deepEqual(result, {
    saved: true,
    tasksCreated: 0,
    managerFlagged: false,
    skipped: [],
    failures: [],
  });
  assert.equal(rec.saved.length, 1);
  assert.deepEqual(rec.openTitlesReads, []);
});

test("a failing branch is reported, never thrown, and never blocks its siblings", async () => {
  const { ports, rec } = makePorts({
    flagForManager: async () => {
      throw new Error("tx deadlock");
    },
  });
  const result = await run(
    intake({ gaps: ["MISSING_TIMELINE"], hasRedFlags: true, redFlagNotes: "חשש" }),
    ports,
  );

  assert.deepEqual(result.failures, [{ effect: "manager", reason: "tx deadlock" }]);
  assert.equal(result.managerFlagged, false);
  // the siblings committed regardless
  assert.equal(result.saved, true);
  assert.equal(result.tasksCreated, 1);
  assert.equal(rec.tasks.length, 1);
});

test("a failing save does not prevent the task fan-out", async () => {
  const { ports, rec } = makePorts({
    saveIntake: async () => {
      throw new Error("db down");
    },
  });
  const result = await run(intake({ gaps: ["MISSING_FAMILY_STATUS"] }), ports);

  assert.equal(result.saved, false);
  assert.deepEqual(result.failures, [{ effect: "save", reason: "db down" }]);
  assert.equal(result.tasksCreated, 1);
  assert.equal(rec.tasks.length, 1);
});

test("the core never reads the clock", async () => {
  for (const now of [NOW, new Date("2027-01-01T00:00:00.000Z")]) {
    const { ports, rec } = makePorts();
    await run(intake({ gaps: ["MISSING_RABBI"] }), ports, now);
    assert.equal(
      rec.tasks[0].dueDate.toISOString(),
      addDays(now, INTAKE_GAP_DUE_DAYS).toISOString(),
    );
    assert.equal(rec.saved[0].at.toISOString(), now.toISOString());
  }
});

test("the manager task title is fixed so a re-run finds its own escalation", () => {
  assert.equal(INTAKE_MANAGER_TASK_TITLE, "בדיקת מנהל: ממצאים חריגים בסיפור האישי");
  assert.equal(
    buildIntakeGapTaskTitle("MISSING_RABBI"),
    `השלמת אינטייק: ${INTAKE_GAP_LABELS.MISSING_RABBI}`,
  );
});

// End-to-end through the contract: raw model text → validated intake → effects.
test("raw Gemini text flows through the schema into the effects", async () => {
  const parsed = parseStoryIntake(
    '```json\n{"motivationSummary":"גדל בבית מסורתי","gaps":["MISSING_REFERENCES","NOPE"],' +
      '"mentionedPeople":["הרב כהן"],"hasRedFlags":true,"redFlagNotes":"סתירה בתאריכים"}\n```',
  );
  assert.ok(parsed.ok);

  const { ports, rec } = makePorts();
  const result = await run(parsed.data, ports);

  assert.equal(result.saved, true);
  assert.equal(result.tasksCreated, 1);
  assert.deepEqual(rec.tasks.map((t) => t.title), [buildIntakeGapTaskTitle("MISSING_REFERENCES")]);
  assert.match(rec.tasks[0].description, /הרב כהן/);
  assert.equal(result.managerFlagged, true);
  assert.deepEqual(rec.managerNotes, ["סתירה בתאריכים"]);
  assert.deepEqual(result.failures, []);
});
