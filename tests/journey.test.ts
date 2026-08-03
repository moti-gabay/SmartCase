import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CASE_STEP_ORDER,
  MIN_REFERENCES,
  nextStep,
  isClientAdvanceable,
  canAdvance,
  isSlotSelectable,
  selectableSlots,
  SLOT_MIN_LEAD_MS,
  type JourneySnapshot,
  type SchedulableSlot,
} from "../src/lib/portal/journey";
import type { CaseStep, DocumentStatus } from "../src/types";

// Baseline snapshot where every guard passes; tests override slices to fail.
const complete = (): JourneySnapshot => ({
  client: { phone: "050-1234567", email: "client@example.com", addressCity: "ירושלים" },
  profile: {
    communityName: "קהילת מרכז",
    sponsoringRabbi: "הרב כהן",
    personalStory: "הסיפור האישי שלי על הדרך ליהדות.",
    storyAudioKey: null,
  },
  mandatoryChecklist: [{ status: "UPLOADED_PENDING_REVIEW" }, { status: "APPROVED" }],
  referenceCount: MIN_REFERENCES,
  hasBookedMeeting: true,
});

// Fresh case: nothing saved yet — profile row doesn't exist (lazy creation).
const empty = (): JourneySnapshot => ({
  client: { phone: "", email: null, addressCity: null },
  profile: null,
  mandatoryChecklist: [{ status: "MISSING" }],
  referenceCount: 0,
  hasBookedMeeting: false,
});

// ── step ordering ──────────────────────────────────────────────────────────────

test("nextStep walks the full journey in order and returns null at the end", () => {
  for (let i = 0; i < CASE_STEP_ORDER.length - 1; i++) {
    assert.equal(nextStep(CASE_STEP_ORDER[i]), CASE_STEP_ORDER[i + 1]);
  }
  assert.equal(nextStep("TRACKING"), null);
});

test("TRACKING is the only step the client can never advance out of", () => {
  const blocked = CASE_STEP_ORDER.filter((s) => !isClientAdvanceable(s));
  // SCHEDULE_MEETING left this list when Smart Scheduling gave the client a way
  // to complete it themselves.
  assert.deepEqual(blocked, ["TRACKING"]);
});

// ── zero-input screens ─────────────────────────────────────────────────────────

test("WELCOME and PROCESS_OVERVIEW advance unconditionally", () => {
  for (const step of ["WELCOME", "PROCESS_OVERVIEW"] as CaseStep[]) {
    assert.deepEqual(canAdvance(step, empty()), { ok: true });
  }
});

// ── WIZARD_PERSONAL ────────────────────────────────────────────────────────────

test("WIZARD_PERSONAL requires phone, email and city", () => {
  assert.deepEqual(canAdvance("WIZARD_PERSONAL", complete()), { ok: true });

  const noEmail = complete();
  noEmail.client.email = null;
  assert.deepEqual(canAdvance("WIZARD_PERSONAL", noEmail), { ok: false, reason: "MISSING_CONTACT_FIELDS" });

  const noCity = complete();
  noCity.client.addressCity = "";
  assert.equal(canAdvance("WIZARD_PERSONAL", noCity).ok, false);
});

test("WIZARD_PERSONAL rejects whitespace-only contact fields (trimmed validation)", () => {
  const s = complete();
  s.client.phone = "   ";
  assert.deepEqual(canAdvance("WIZARD_PERSONAL", s), { ok: false, reason: "MISSING_CONTACT_FIELDS" });
});

// ── WIZARD_FAMILY (lazy profile generation) ────────────────────────────────────

test("WIZARD_FAMILY fails safely when the profile row doesn't exist yet", () => {
  const s = complete();
  s.profile = null; // lazy creation: no submit has happened yet
  assert.deepEqual(canAdvance("WIZARD_FAMILY", s), { ok: false, reason: "FAMILY_NOT_SAVED" });
});

test("WIZARD_FAMILY passes once a profile row exists, even with all-empty family fields", () => {
  const s = complete();
  s.profile = { communityName: null, sponsoringRabbi: null, personalStory: null, storyAudioKey: null };
  assert.deepEqual(canAdvance("WIZARD_FAMILY", s), { ok: true });
});

// ── WIZARD_BACKGROUND ──────────────────────────────────────────────────────────

test("WIZARD_BACKGROUND requires community and rabbi, never throws on null profile", () => {
  assert.deepEqual(canAdvance("WIZARD_BACKGROUND", complete()), { ok: true });

  const nullProfile = complete();
  nullProfile.profile = null;
  assert.deepEqual(canAdvance("WIZARD_BACKGROUND", nullProfile), { ok: false, reason: "MISSING_BACKGROUND_FIELDS" });

  const noRabbi = complete();
  noRabbi.profile!.sponsoringRabbi = "  ";
  assert.equal(canAdvance("WIZARD_BACKGROUND", noRabbi).ok, false);
});

// ── PERSONAL_STORY (trimmed length validation) ─────────────────────────────────

test("PERSONAL_STORY requires a non-empty trimmed story when there is no recording", () => {
  assert.deepEqual(canAdvance("PERSONAL_STORY", complete()), { ok: true });

  for (const story of [null, "", "   ", "\n\t "]) {
    const s = complete();
    s.profile!.personalStory = story;
    assert.deepEqual(canAdvance("PERSONAL_STORY", s), { ok: false, reason: "MISSING_PERSONAL_STORY" });
  }

  const nullProfile = complete();
  nullProfile.profile = null;
  assert.equal(canAdvance("PERSONAL_STORY", nullProfile).ok, false);
});

test("PERSONAL_STORY accepts a voice recording instead of written text", () => {
  for (const story of [null, "", "   "]) {
    const s = complete();
    s.profile!.personalStory = story;
    s.profile!.storyAudioKey = "cases/case_1/story/1750000000000-story.webm";
    assert.deepEqual(canAdvance("PERSONAL_STORY", s), { ok: true }, "a recording alone must satisfy the step");
  }
});

test("PERSONAL_STORY rejects a blank audio key just like blank text", () => {
  for (const key of [null, "", "  "]) {
    const s = complete();
    s.profile!.personalStory = null;
    s.profile!.storyAudioKey = key;
    assert.deepEqual(canAdvance("PERSONAL_STORY", s), { ok: false, reason: "MISSING_PERSONAL_STORY" });
  }
});

test("PERSONAL_STORY still needs a saved profile even with an audio key", () => {
  const s = complete();
  s.profile = null;
  assert.deepEqual(canAdvance("PERSONAL_STORY", s), { ok: false, reason: "MISSING_PERSONAL_STORY" });
});

// ── WIZARD_REFERENCES ──────────────────────────────────────────────────────────

test("WIZARD_REFERENCES sits between PERSONAL_STORY and PENDING_DOCS", () => {
  assert.equal(nextStep("PERSONAL_STORY"), "WIZARD_REFERENCES");
  assert.equal(nextStep("WIZARD_REFERENCES"), "PENDING_DOCS");
});

test("WIZARD_REFERENCES requires at least MIN_REFERENCES saved recommenders", () => {
  assert.deepEqual(canAdvance("WIZARD_REFERENCES", complete()), { ok: true });

  for (let n = 0; n < MIN_REFERENCES; n++) {
    const s = complete();
    s.referenceCount = n;
    assert.deepEqual(
      canAdvance("WIZARD_REFERENCES", s),
      { ok: false, reason: "MISSING_REFERENCES" },
      `${n} reference(s) must not pass the guard`
    );
  }
});

test("WIZARD_REFERENCES still advances when more than the minimum are saved", () => {
  const s = complete();
  s.referenceCount = MIN_REFERENCES + 3;
  assert.deepEqual(canAdvance("WIZARD_REFERENCES", s), { ok: true });
});

test("WIZARD_REFERENCES is client-advanceable and never depends on the profile row", () => {
  assert.ok(isClientAdvanceable("WIZARD_REFERENCES"));
  const s = complete();
  s.profile = null; // references are counted independently of profile field state
  assert.deepEqual(canAdvance("WIZARD_REFERENCES", s), { ok: true });
});

// ── PENDING_DOCS ───────────────────────────────────────────────────────────────

test("PENDING_DOCS requires every mandatory item past MISSING/PENDING_UPLOAD", () => {
  assert.deepEqual(canAdvance("PENDING_DOCS", complete()), { ok: true });

  for (const status of ["MISSING", "PENDING_UPLOAD"] as DocumentStatus[]) {
    const s = complete();
    s.mandatoryChecklist = [{ status: "APPROVED" }, { status }];
    assert.deepEqual(canAdvance("PENDING_DOCS", s), { ok: false, reason: "MISSING_MANDATORY_DOCUMENTS" });
  }

  // No mandatory items at all → vacuously complete.
  const none = complete();
  none.mandatoryChecklist = [];
  assert.deepEqual(canAdvance("PENDING_DOCS", none), { ok: true });
});

// ── staff-driven / terminal steps stay safe even if called directly ────────────

test("SCHEDULE_MEETING advances only once a slot is actually booked", () => {
  assert.deepEqual(canAdvance("SCHEDULE_MEETING", complete()), { ok: true });
  assert.deepEqual(canAdvance("SCHEDULE_MEETING", { ...complete(), hasBookedMeeting: false }), {
    ok: false,
    reason: "MEETING_NOT_SCHEDULED",
  });
});

test("a booked meeting alone does not skip the earlier guards", () => {
  // hasBookedMeeting must not leak backwards into steps that own other rules.
  const booked = { ...empty(), hasBookedMeeting: true };
  assert.equal(canAdvance("WIZARD_PERSONAL", booked).ok, false);
  assert.equal(canAdvance("PENDING_DOCS", booked).ok, false);
});

test("TRACKING is terminal even with a complete snapshot", () => {
  assert.deepEqual(canAdvance("TRACKING", complete()), { ok: false, reason: "JOURNEY_COMPLETE" });
});

// ── slot selection ─────────────────────────────────────────────────────────────

const NOW = new Date("2026-08-03T10:00:00.000Z");

const slot = (over: Partial<SchedulableSlot> = {}): SchedulableSlot => ({
  id: "slot-1",
  startsAt: new Date(NOW.getTime() + 3 * SLOT_MIN_LEAD_MS).toISOString(),
  durationMinutes: 45,
  location: "משרד המשרד",
  isPublished: true,
  isBooked: false,
  ...over,
});

test("a slot is selectable only when published, unbooked and past the lead time", () => {
  assert.equal(isSlotSelectable(slot(), NOW), true);
  assert.equal(isSlotSelectable(slot({ isPublished: false }), NOW), false);
  assert.equal(isSlotSelectable(slot({ isBooked: true }), NOW), false);
});

test("the lead time is a hard boundary, not a soft preference", () => {
  const exactly = new Date(NOW.getTime() + SLOT_MIN_LEAD_MS).toISOString();
  const justUnder = new Date(NOW.getTime() + SLOT_MIN_LEAD_MS - 1000).toISOString();
  assert.equal(isSlotSelectable(slot({ startsAt: exactly }), NOW), true);
  assert.equal(isSlotSelectable(slot({ startsAt: justUnder }), NOW), false);
});

test("a past or unparseable start is never offered", () => {
  assert.equal(isSlotSelectable(slot({ startsAt: "2026-01-01T09:00:00.000Z" }), NOW), false);
  assert.equal(isSlotSelectable(slot({ startsAt: "בקרוב" }), NOW), false);
  assert.equal(isSlotSelectable(slot({ startsAt: "" }), NOW), false);
});

test("selectableSlots filters and sorts soonest-first regardless of input order", () => {
  const far = slot({ id: "far", startsAt: new Date(NOW.getTime() + 10 * SLOT_MIN_LEAD_MS).toISOString() });
  const near = slot({ id: "near", startsAt: new Date(NOW.getTime() + 2 * SLOT_MIN_LEAD_MS).toISOString() });
  const taken = slot({ id: "taken", isBooked: true });
  const soon = slot({ id: "soon", startsAt: new Date(NOW.getTime() + 60_000).toISOString() });

  const result = selectableSlots([far, taken, soon, near], NOW);
  assert.deepEqual(result.map((s) => s.id), ["near", "far"]);
});

test("selectableSlots returns an empty list rather than throwing when nothing qualifies", () => {
  assert.deepEqual(selectableSlots([slot({ isBooked: true })], NOW), []);
  assert.deepEqual(selectableSlots([], NOW), []);
});

test("a custom lead time overrides the default without touching the other rules", () => {
  const soon = slot({ startsAt: new Date(NOW.getTime() + 60_000).toISOString() });
  assert.equal(isSlotSelectable(soon, NOW), false);
  assert.equal(isSlotSelectable(soon, NOW, 30_000), true);
  // still blocked for the reasons that are not about time
  assert.equal(isSlotSelectable({ ...soon, isBooked: true }, NOW, 30_000), false);
});
