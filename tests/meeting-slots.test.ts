import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SLOT_DURATION_MINUTES,
  MIN_LEAD_TIME_MS,
  MIN_SLOT_DURATION_MINUTES,
  createMeetingSlotSchema,
  deleteMeetingSlotSchema,
  generateMeetingSlotsSchema,
  listMeetingSlotsSchema,
  slotEndsAt,
  type GenerateMeetingSlotsInput,
} from "../src/lib/schemas/meeting-slot-schema";
import {
  DELETE_REASON_BOOKED,
  DELETE_REASON_NOT_FOUND,
  GENERATE_REASON_BAD_RANGE,
  SKIP_REASON_BATCH_OVERLAP,
  SKIP_REASON_LEAD_TIME,
  SKIP_REASON_OVERLAP,
  createMeetingSlots,
  deleteMeetingSlot,
  detectOverlaps,
  expandRecurringSlots,
  generateRecurringSlots,
  screenCandidates,
  validateLeadTime,
  type ExistingSlot,
  type MeetingSlotPorts,
  type SlotCandidate,
} from "../src/lib/workflows/meeting-slot-management";

// ── fixtures ──────────────────────────────────────────────────────────────────

const NOW = new Date("2026-08-03T10:00:00.000Z");

function at(iso: string): Date {
  return new Date(iso);
}

function candidate(iso: string, durationMinutes = 45): SlotCandidate {
  return { startsAt: at(iso), durationMinutes, isPublished: true };
}

function existing(iso: string, durationMinutes = 45, bookedCaseId: string | null = null): ExistingSlot {
  return { id: `slot-${iso}`, startsAt: at(iso), durationMinutes, bookedCaseId };
}

interface Recorded {
  windows: { from: Date; to: Date }[];
  created: SlotCandidate[][];
  deleted: string[];
}

function fakePorts(
  existingSlots: ExistingSlot[] = [],
  lookup: Record<string, ExistingSlot> = {},
): { ports: MeetingSlotPorts; recorded: Recorded } {
  const recorded: Recorded = { windows: [], created: [], deleted: [] };
  const ports: MeetingSlotPorts = {
    listSlotsInRange: async (from, to) => {
      recorded.windows.push({ from, to });
      return existingSlots.filter(
        (slot) => slot.startsAt.getTime() >= from.getTime() && slot.startsAt.getTime() <= to.getTime(),
      );
    },
    createSlots: async (slots) => {
      recorded.created.push(slots);
      return slots;
    },
    findSlot: async (id) => lookup[id] ?? null,
    deleteSlot: async (id) => {
      recorded.deleted.push(id);
    },
  };
  return { ports, recorded };
}

// ── slotEndsAt: the only end-time derivation ──────────────────────────────────

test("slotEndsAt derives the end from startsAt + durationMinutes and never mutates its input", () => {
  const start = at("2026-09-14T10:00:00.000Z");
  assert.equal(slotEndsAt(start, 45).toISOString(), "2026-09-14T10:45:00.000Z");
  assert.equal(slotEndsAt(start, MAX_SLOT_DURATION_MINUTES).toISOString(), "2026-09-14T14:00:00.000Z");
  assert.equal(start.toISOString(), "2026-09-14T10:00:00.000Z");
});

// ── lead time ─────────────────────────────────────────────────────────────────

test("validateLeadTime is strict: exactly 24h out is refused, one ms more is accepted", () => {
  assert.equal(validateLeadTime(new Date(NOW.getTime() + MIN_LEAD_TIME_MS), NOW), false);
  assert.equal(validateLeadTime(new Date(NOW.getTime() + MIN_LEAD_TIME_MS + 1), NOW), true);
  assert.equal(validateLeadTime(new Date(NOW.getTime() + MIN_LEAD_TIME_MS - 1), NOW), false);
  assert.equal(validateLeadTime(new Date(NOW.getTime() - MIN_LEAD_TIME_MS), NOW), false);
});

test("a sub-24h slot is skipped with the lead-time reason and never written", async () => {
  const { ports, recorded } = fakePorts();
  const result = await createMeetingSlots(
    { startsAt: at("2026-08-04T09:00:00.000Z"), durationMinutes: 45, isPublished: true },
    ports,
    NOW,
  );

  assert.deepEqual(result.created, []);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].reason, SKIP_REASON_LEAD_TIME);
  // zero accepted candidates ⇒ the insert port is never touched
  assert.deepEqual(recorded.created, []);
});

// ── overlap detection ─────────────────────────────────────────────────────────

test("detectOverlaps flags an exactly-identical slot", () => {
  const hit = detectOverlaps([candidate("2026-09-14T10:00:00.000Z")], [existing("2026-09-14T10:00:00.000Z")]);
  assert.equal(hit.length, 1);
});

test("detectOverlaps flags partial overlap from either side", () => {
  const base = existing("2026-09-14T10:00:00.000Z", 60); // 10:00–11:00
  assert.equal(detectOverlaps([candidate("2026-09-14T10:30:00.000Z", 60)], [base]).length, 1);
  assert.equal(detectOverlaps([candidate("2026-09-14T09:30:00.000Z", 60)], [base]).length, 1);
});

test("detectOverlaps flags full containment in both directions", () => {
  const long = existing("2026-09-14T09:00:00.000Z", MAX_SLOT_DURATION_MINUTES); // 09:00–13:00
  assert.equal(detectOverlaps([candidate("2026-09-14T11:00:00.000Z", 15)], [long]).length, 1);

  const short = existing("2026-09-14T11:00:00.000Z", 15);
  assert.equal(
    detectOverlaps([candidate("2026-09-14T09:00:00.000Z", MAX_SLOT_DURATION_MINUTES)], [short]).length,
    1,
  );
});

test("touching boundaries are NOT an overlap — [start, end) is half-open, both directions", () => {
  const base = existing("2026-09-14T10:00:00.000Z", 45); // 10:00–10:45
  // candidate starts exactly when the existing one ends
  assert.deepEqual(detectOverlaps([candidate("2026-09-14T10:45:00.000Z", 45)], [base]), []);
  // candidate ends exactly when the existing one starts
  assert.deepEqual(detectOverlaps([candidate("2026-09-14T09:15:00.000Z", 45)], [base]), []);
});

test("back-to-back chains all survive against a populated calendar", () => {
  const calendar = [existing("2026-09-14T09:00:00.000Z", 60)]; // 09:00–10:00
  const chain = [
    candidate("2026-09-14T10:00:00.000Z", 60),
    candidate("2026-09-14T11:00:00.000Z", 60),
    candidate("2026-09-14T12:00:00.000Z", 60),
  ];
  assert.deepEqual(detectOverlaps(chain, calendar), []);
});

test("detectOverlaps returns every colliding candidate, not just the first", () => {
  const base = existing("2026-09-14T10:00:00.000Z", MAX_SLOT_DURATION_MINUTES); // 10:00–14:00
  const hits = detectOverlaps(
    [candidate("2026-09-14T10:00:00.000Z"), candidate("2026-09-14T20:00:00.000Z"), candidate("2026-09-14T13:00:00.000Z")],
    [base],
  );
  assert.equal(hits.length, 2);
});

test("an empty calendar or an empty batch collides with nothing", () => {
  assert.deepEqual(detectOverlaps([candidate("2026-09-14T10:00:00.000Z")], []), []);
  assert.deepEqual(detectOverlaps([], [existing("2026-09-14T10:00:00.000Z")]), []);
});

test("a booked existing slot still blocks — bookedCaseId does not exempt it from overlap", () => {
  const booked = existing("2026-09-14T10:00:00.000Z", 45, "case-1");
  assert.equal(detectOverlaps([candidate("2026-09-14T10:15:00.000Z")], [booked]).length, 1);
});

// ── screening order & intra-batch collisions ──────────────────────────────────

test("screenCandidates refuses a candidate that collides with the batch's own accepted slot", () => {
  const result = screenCandidates(
    [candidate("2026-09-20T10:00:00.000Z", 60), candidate("2026-09-20T10:30:00.000Z", 60)],
    [],
    NOW,
  );

  assert.equal(result.accepted.length, 1);
  assert.equal(result.accepted[0].startsAt.toISOString(), "2026-09-20T10:00:00.000Z");
  assert.deepEqual(result.skipped, [
    { startsAt: at("2026-09-20T10:30:00.000Z"), reason: SKIP_REASON_BATCH_OVERLAP },
  ]);
});

test("a skipped candidate never becomes a batch obstacle for the next one", () => {
  // The first candidate loses to the DB; the second must be judged against the
  // DB only, not against the rejected first.
  const result = screenCandidates(
    [candidate("2026-09-20T10:00:00.000Z", 60), candidate("2026-09-20T10:30:00.000Z", 60)],
    [existing("2026-09-20T10:00:00.000Z", 15)],
    NOW,
  );

  assert.equal(result.skipped[0].reason, SKIP_REASON_OVERLAP);
  assert.equal(result.accepted.length, 1);
  assert.equal(result.accepted[0].startsAt.toISOString(), "2026-09-20T10:30:00.000Z");
});

test("screening order is lead-time → DB overlap → batch overlap", () => {
  // A candidate that is both too soon AND overlapping reports the lead-time reason.
  const soon = candidate("2026-08-03T20:00:00.000Z");
  const result = screenCandidates([soon], [existing("2026-08-03T20:00:00.000Z")], NOW);
  assert.deepEqual(result.accepted, []);
  assert.equal(result.skipped[0].reason, SKIP_REASON_LEAD_TIME);
});

test("duplicate identical candidates inside one batch keep exactly one", () => {
  const result = screenCandidates(
    [candidate("2026-09-20T10:00:00.000Z"), candidate("2026-09-20T10:00:00.000Z")],
    [],
    NOW,
  );
  assert.equal(result.accepted.length, 1);
  assert.equal(result.skipped[0].reason, SKIP_REASON_BATCH_OVERLAP);
});

// ── recurring expansion ───────────────────────────────────────────────────────

function generateInput(overrides: Partial<GenerateMeetingSlotsInput> = {}): GenerateMeetingSlotsInput {
  return {
    startDate: at("2026-09-14T00:00:00.000Z"), // Monday
    endDate: at("2026-09-20T00:00:00.000Z"), // Sunday
    weekdays: [1],
    timesOfDay: ["10:00"],
    durationMinutes: 45,
    isPublished: true,
    ...overrides,
  };
}

test("expandRecurringSlots walks both bounds inclusively and only the chosen weekdays", () => {
  const slots = expandRecurringSlots(generateInput({ weekdays: [1, 0] }));
  assert.deepEqual(
    slots.map((slot) => slot.startsAt.toISOString()),
    ["2026-09-14T10:00:00.000Z", "2026-09-20T10:00:00.000Z"],
  );
  // weekday indices really are JS getDay(): 1 = Monday, 0 = Sunday
  assert.equal(slots[0].startsAt.getUTCDay(), 1);
  assert.equal(slots[1].startsAt.getUTCDay(), 0);
});

test("expandRecurringSlots crosses a DST changeover without drifting the wall time (UTC arithmetic)", () => {
  // Europe/Israel and US DST both flip inside this range; UTC day-walking must
  // keep every slot at exactly 10:00Z on a Sunday.
  const slots = expandRecurringSlots(
    generateInput({
      startDate: at("2026-10-18T00:00:00.000Z"),
      endDate: at("2026-11-08T00:00:00.000Z"),
      weekdays: [0],
    }),
  );
  assert.deepEqual(
    slots.map((slot) => slot.startsAt.toISOString()),
    [
      "2026-10-18T10:00:00.000Z",
      "2026-10-25T10:00:00.000Z",
      "2026-11-01T10:00:00.000Z",
      "2026-11-08T10:00:00.000Z",
    ],
  );
});

test("expandRecurringSlots emits every time of day, chronologically sorted", () => {
  const slots = expandRecurringSlots(
    generateInput({ weekdays: [1], timesOfDay: ["16:30", "09:00", "12:15"] }),
  );
  assert.deepEqual(
    slots.map((slot) => slot.startsAt.toISOString()),
    ["2026-09-14T09:00:00.000Z", "2026-09-14T12:15:00.000Z", "2026-09-14T16:30:00.000Z"],
  );
});

test("expandRecurringSlots normalizes a start bound that carries a time of day", () => {
  const slots = expandRecurringSlots(
    generateInput({ startDate: at("2026-09-14T23:45:00.000Z"), timesOfDay: ["08:00"] }),
  );
  assert.deepEqual(
    slots.map((slot) => slot.startsAt.toISOString()),
    ["2026-09-14T08:00:00.000Z"],
  );
});

test("a weekday that never falls inside the range expands to nothing", () => {
  assert.deepEqual(
    expandRecurringSlots(
      generateInput({ startDate: at("2026-09-14T00:00:00.000Z"), endDate: at("2026-09-16T00:00:00.000Z"), weekdays: [6] }),
    ),
    [],
  );
});

test("a single-day range (startDate === endDate) still emits that day", () => {
  const slots = expandRecurringSlots(
    generateInput({ startDate: at("2026-09-14T00:00:00.000Z"), endDate: at("2026-09-14T00:00:00.000Z") }),
  );
  assert.equal(slots.length, 1);
});

test("expandRecurringSlots carries location and isPublished onto every candidate", () => {
  const slots = expandRecurringSlots(
    generateInput({ weekdays: [1, 0], location: "משרד ראשי", isPublished: false }),
  );
  assert.equal(slots.length, 2);
  for (const slot of slots) {
    assert.equal(slot.location, "משרד ראשי");
    assert.equal(slot.isPublished, false);
  }
});

// ── orchestrators ─────────────────────────────────────────────────────────────

test("an inverted range is reported, never thrown, and touches no port", async () => {
  const { ports, recorded } = fakePorts();
  const result = await generateRecurringSlots(
    generateInput({ startDate: at("2026-09-20T00:00:00.000Z"), endDate: at("2026-09-14T00:00:00.000Z") }),
    ports,
    NOW,
  );

  assert.deepEqual(result.created, []);
  assert.deepEqual(result.skipped, [
    { startsAt: at("2026-09-20T00:00:00.000Z"), reason: GENERATE_REASON_BAD_RANGE },
  ]);
  assert.deepEqual(recorded.windows, []);
  assert.deepEqual(recorded.created, []);
});

test("a partially-conflicting batch reports both halves instead of throwing", async () => {
  const { ports, recorded } = fakePorts([existing("2026-09-21T10:00:00.000Z", 45)]);
  const result = await generateRecurringSlots(
    generateInput({
      startDate: at("2026-09-14T00:00:00.000Z"),
      endDate: at("2026-09-28T00:00:00.000Z"),
      weekdays: [1],
    }),
    ports,
    NOW,
  );

  assert.deepEqual(
    result.created.map((slot) => slot.startsAt.toISOString()),
    ["2026-09-14T10:00:00.000Z", "2026-09-28T10:00:00.000Z"],
  );
  assert.deepEqual(result.skipped, [
    { startsAt: at("2026-09-21T10:00:00.000Z"), reason: SKIP_REASON_OVERLAP },
  ]);
  assert.equal(recorded.created.length, 1);
});

test("the overlap window is padded a full day on each side so a long earlier slot is visible", async () => {
  const { ports, recorded } = fakePorts();
  await createMeetingSlots(
    { startsAt: at("2026-09-14T10:00:00.000Z"), durationMinutes: 45, isPublished: true },
    ports,
    NOW,
  );

  assert.equal(recorded.windows.length, 1);
  assert.equal(recorded.windows[0].from.toISOString(), "2026-09-13T10:00:00.000Z");
  assert.equal(recorded.windows[0].to.toISOString(), "2026-09-15T10:45:00.000Z");
});

test("createMeetingSlots passes location and isPublished straight through", async () => {
  const { ports, recorded } = fakePorts();
  const result = await createMeetingSlots(
    { startsAt: at("2026-09-14T10:00:00.000Z"), durationMinutes: 30, location: "זום", isPublished: false },
    ports,
    NOW,
  );

  assert.deepEqual(result.skipped, []);
  assert.deepEqual(recorded.created[0], [
    { startsAt: at("2026-09-14T10:00:00.000Z"), durationMinutes: 30, location: "זום", isPublished: false },
  ]);
});

test("a fully-refused batch never calls createSlots", async () => {
  const { ports, recorded } = fakePorts([
    existing("2026-09-14T10:00:00.000Z", 45),
    existing("2026-09-21T10:00:00.000Z", 45),
  ]);
  const result = await generateRecurringSlots(
    generateInput({ startDate: at("2026-09-14T00:00:00.000Z"), endDate: at("2026-09-21T00:00:00.000Z") }),
    ports,
    NOW,
  );

  assert.deepEqual(result.created, []);
  assert.equal(result.skipped.length, 2);
  assert.deepEqual(recorded.created, []);
});

// ── deletion ──────────────────────────────────────────────────────────────────

test("deleting a booked slot is refused — the client commitment is never orphaned", async () => {
  const booked = existing("2026-09-14T10:00:00.000Z", 45, "case-1");
  const { ports, recorded } = fakePorts([], { [booked.id]: booked });

  const result = await deleteMeetingSlot(booked.id, ports);
  assert.deepEqual(result, { deleted: false, reason: DELETE_REASON_BOOKED });
  assert.deepEqual(recorded.deleted, []);
});

test("deleting a free slot succeeds; a missing id is reported, not thrown", async () => {
  const free = existing("2026-09-14T10:00:00.000Z");
  const { ports, recorded } = fakePorts([], { [free.id]: free });

  assert.deepEqual(await deleteMeetingSlot(free.id, ports), { deleted: true });
  assert.deepEqual(recorded.deleted, [free.id]);

  assert.deepEqual(await deleteMeetingSlot("nope", ports), {
    deleted: false,
    reason: DELETE_REASON_NOT_FOUND,
  });
  assert.deepEqual(recorded.deleted, [free.id]);
});

// ── schema hardening ──────────────────────────────────────────────────────────

test("createMeetingSlotSchema accepts an ISO string or a Date and always emits isPublished", () => {
  const fromString = createMeetingSlotSchema.parse({
    startsAt: "2026-09-14T10:00:00.000Z",
    durationMinutes: 45,
  });
  assert.ok(fromString.startsAt instanceof Date);
  assert.equal(fromString.startsAt.toISOString(), "2026-09-14T10:00:00.000Z");
  assert.equal(fromString.isPublished, true);
  assert.equal(fromString.location, undefined);

  const fromDate = createMeetingSlotSchema.parse({
    startsAt: at("2026-09-14T10:00:00.000Z"),
    durationMinutes: 45,
    isPublished: false,
  });
  assert.equal(fromDate.isPublished, false);
});

test("createMeetingSlotSchema trims location and enforces its bounds", () => {
  assert.equal(
    createMeetingSlotSchema.parse({
      startsAt: "2026-09-14T10:00:00.000Z",
      durationMinutes: 45,
      location: "  משרד ראשי  ",
    }).location,
    "משרד ראשי",
  );
  for (const location of ["", "   ", "א".repeat(201)]) {
    assert.equal(
      createMeetingSlotSchema.safeParse({
        startsAt: "2026-09-14T10:00:00.000Z",
        durationMinutes: 45,
        location,
      }).success,
      false,
      `expected rejection for location=${JSON.stringify(location)}`,
    );
  }
});

test("duration bounds are enforced at both ends and integers only", () => {
  for (const durationMinutes of [MIN_SLOT_DURATION_MINUTES, 45, MAX_SLOT_DURATION_MINUTES]) {
    assert.equal(
      createMeetingSlotSchema.safeParse({ startsAt: "2026-09-14T10:00:00.000Z", durationMinutes }).success,
      true,
      `expected ${durationMinutes} to be accepted`,
    );
  }
  for (const durationMinutes of [
    MIN_SLOT_DURATION_MINUTES - 1,
    MAX_SLOT_DURATION_MINUTES + 1,
    0,
    -45,
    45.5,
    "45",
    null,
    Infinity,
    NaN,
  ]) {
    assert.equal(
      createMeetingSlotSchema.safeParse({ startsAt: "2026-09-14T10:00:00.000Z", durationMinutes }).success,
      false,
      `expected rejection for durationMinutes=${JSON.stringify(durationMinutes)}`,
    );
  }
});

test("createMeetingSlotSchema rejects malformed startsAt values", () => {
  for (const startsAt of [
    "2026-09-14",
    // No offset: coercing this would silently mean "server-local time".
    "2026-09-14T10:00:00",
    "2026-09-14T10:00:00.000",
    "14/09/2026",
    "בקרוב",
    "",
    null,
    undefined,
    1757844000000,
    new Date("nope"),
  ]) {
    assert.equal(
      createMeetingSlotSchema.safeParse({ startsAt, durationMinutes: 45 }).success,
      false,
      `expected rejection for startsAt=${JSON.stringify(startsAt)}`,
    );
  }
});

test("generateMeetingSlotsSchema accepts a plain YYYY-MM-DD day bound at UTC midnight", () => {
  const parsed = generateMeetingSlotsSchema.parse({
    startDate: "2026-09-14",
    endDate: "2026-09-28",
    weekdays: [1],
    timesOfDay: ["10:00"],
    durationMinutes: 45,
  });
  assert.equal(parsed.startDate.toISOString(), "2026-09-14T00:00:00.000Z");
  assert.equal(parsed.endDate.toISOString(), "2026-09-28T00:00:00.000Z");
  assert.equal(parsed.isPublished, true);

  // An offset-carrying bound is honoured; an offset-less one is refused rather
  // than reinterpreted as server-local time.
  assert.equal(
    generateMeetingSlotsSchema.parse({
      startDate: "2026-09-14T00:00:00+03:00",
      endDate: "2026-09-28",
      weekdays: [1],
      timesOfDay: ["10:00"],
      durationMinutes: 45,
    }).startDate.toISOString(),
    "2026-09-13T21:00:00.000Z",
  );
  assert.equal(
    generateMeetingSlotsSchema.safeParse({
      startDate: "2026-09-14T00:00:00",
      endDate: "2026-09-28",
      weekdays: [1],
      timesOfDay: ["10:00"],
      durationMinutes: 45,
    }).success,
    false,
  );
});

test("generateMeetingSlotsSchema rejects empty or out-of-range weekdays", () => {
  const base = {
    startDate: "2026-09-14",
    endDate: "2026-09-28",
    timesOfDay: ["10:00"],
    durationMinutes: 45,
  };
  for (const weekdays of [[], [7], [-1], [1.5], ["1"], "1", null]) {
    assert.equal(
      generateMeetingSlotsSchema.safeParse({ ...base, weekdays }).success,
      false,
      `expected rejection for weekdays=${JSON.stringify(weekdays)}`,
    );
  }
  assert.equal(generateMeetingSlotsSchema.safeParse({ ...base, weekdays: [0, 6] }).success, true);
});

test("timesOfDay is strict HH:MM 24h and never empty", () => {
  const base = {
    startDate: "2026-09-14",
    endDate: "2026-09-28",
    weekdays: [1],
    durationMinutes: 45,
  };
  for (const timesOfDay of [[], ["24:00"], ["9:00"], ["10:60"], ["10"], ["10:00:00"], [""], ["1000"], [10]]) {
    assert.equal(
      generateMeetingSlotsSchema.safeParse({ ...base, timesOfDay }).success,
      false,
      `expected rejection for timesOfDay=${JSON.stringify(timesOfDay)}`,
    );
  }
  for (const timesOfDay of [["00:00"], ["23:59"], ["09:05", "16:30"]]) {
    assert.equal(
      generateMeetingSlotsSchema.safeParse({ ...base, timesOfDay }).success,
      true,
      `expected acceptance for timesOfDay=${JSON.stringify(timesOfDay)}`,
    );
  }
});

test("listMeetingSlotsSchema defaults includeUnpublished to false and keeps bounds optional", () => {
  const bare = listMeetingSlotsSchema.parse({});
  assert.deepEqual(bare, { includeUnpublished: false });
  assert.equal(
    listMeetingSlotsSchema.parse({ from: "2026-09-14T10:00:00.000Z" }).from?.toISOString(),
    "2026-09-14T10:00:00.000Z",
  );
  assert.equal(listMeetingSlotsSchema.parse({ includeUnpublished: true }).includeUnpublished, true);
  assert.equal(listMeetingSlotsSchema.safeParse({ from: "not-a-date" }).success, false);
});

test("deleteMeetingSlotSchema requires a non-empty id", () => {
  assert.equal(deleteMeetingSlotSchema.parse({ id: "slot-1" }).id, "slot-1");
  for (const id of ["", null, undefined, 1]) {
    assert.equal(deleteMeetingSlotSchema.safeParse({ id }).success, false, `expected rejection for ${JSON.stringify(id)}`);
  }
});

// ── schema → engine, end to end ───────────────────────────────────────────────

test("a raw staff payload flows through the schema into exactly the slots it implies", async () => {
  const parsed = generateMeetingSlotsSchema.parse({
    startDate: "2026-09-14",
    endDate: "2026-09-21",
    weekdays: [1],
    timesOfDay: ["10:00", "10:30"],
    durationMinutes: 45,
    location: "  משרד ראשי  ",
  });

  const { ports } = fakePorts([existing("2026-09-21T10:00:00.000Z", 15)]);
  const result = await generateRecurringSlots(parsed, ports, NOW);

  // 14th 10:00 lands; 14th 10:30 self-collides; 21st 10:00 hits the calendar;
  // 21st 10:30 is then free because the rejected 10:00 is not an obstacle.
  assert.deepEqual(
    result.created.map((slot) => slot.startsAt.toISOString()),
    ["2026-09-14T10:00:00.000Z", "2026-09-21T10:30:00.000Z"],
  );
  assert.deepEqual(result.skipped.map((skip) => skip.reason), [
    SKIP_REASON_BATCH_OVERLAP,
    SKIP_REASON_OVERLAP,
  ]);
  assert.equal(result.created[0].location, "משרד ראשי");
});
