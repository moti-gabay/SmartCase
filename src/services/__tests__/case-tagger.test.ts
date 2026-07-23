import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  addTag,
  removeTag,
  filterCasesByTags,
  createJsonlAuditWriter,
  TAG_COLOR_PALETTE,
  type AuditWriter,
} from "../case-tagger";
import type { CaseTag, TaggedCase, TagColor } from "@/types/case-tags";
import type { Priority } from "@/types/index";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** Collects audit events in memory so no files are written. */
function captureAudit(): { writer: AuditWriter; events: Parameters<AuditWriter>[0][] } {
  const events: Parameters<AuditWriter>[0][] = [];
  return { writer: (e) => events.push(e), events };
}

function makeTag(overrides: Partial<CaseTag> = {}): CaseTag {
  return {
    id: overrides.id ?? "tag-1",
    label: overrides.label ?? "דחוף",
    category: overrides.category ?? "URGENCY",
    color: overrides.color ?? TAG_COLOR_PALETTE[0],
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
  };
}

function makeCase(
  overrides: Partial<TaggedCase> = {}
): TaggedCase {
  const priority: Priority = overrides.priority ?? "MEDIUM";
  return {
    id: overrides.id ?? "case-1",
    caseNumber: overrides.caseNumber ?? "SC-2026-00001",
    clientId: overrides.clientId ?? "client-1",
    clientName: overrides.clientName ?? "ישראל ישראלי",
    caseType: overrides.caseType ?? "CONVERSION",
    status: overrides.status ?? "NEW_INTAKE",
    priority,
    assignedAgentName: overrides.assignedAgentName ?? null,
    hasMissingDocuments: overrides.hasMissingDocuments ?? false,
    isOverdue: overrides.isOverdue ?? false,
    nextFollowUpDate: overrides.nextFollowUpDate ?? null,
    submissionDeadline: overrides.submissionDeadline ?? null,
    missingDocsCount: overrides.missingDocsCount ?? 0,
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:00.000Z",
    tags: overrides.tags ?? [],
  };
}

// ─── addTag ──────────────────────────────────────────────────────────────────

test("addTag: returns new case with tag, leaves input unchanged, audits TAG_ADDED", () => {
  const { writer, events } = captureAudit();
  const original = makeCase();
  const tag = makeTag();

  const updated = addTag(original, tag, { audit: writer });

  assert.equal(updated.tags.length, 1);
  assert.equal(updated.tags[0].id, "tag-1");
  // Immutability: input untouched, new object references.
  assert.equal(original.tags.length, 0);
  assert.notEqual(updated, original);
  assert.notEqual(updated.tags, original.tags);

  assert.equal(events.length, 1);
  assert.equal(events[0].action, "TAG_ADDED");
  assert.equal(events[0].caseId, "case-1");
  assert.equal(events[0].tagId, "tag-1");
  assert.equal(events[0].label, "דחוף");
});

test("addTag: rejects invalid color, throws and audits TAG_REJECTED", () => {
  const { writer, events } = captureAudit();
  const tag = makeTag({ color: "#000000" as TagColor });

  assert.throws(() => addTag(makeCase(), tag, { audit: writer }), /Invalid tag color/);
  assert.equal(events.length, 1);
  assert.equal(events[0].action, "TAG_REJECTED");
  assert.match(events[0].reason ?? "", /Invalid tag color/);
});

test("addTag: rejects empty label", () => {
  const { writer, events } = captureAudit();
  assert.throws(
    () => addTag(makeCase(), makeTag({ label: "" }), { audit: writer }),
    /must not be empty/
  );
  assert.equal(events[0].action, "TAG_REJECTED");
  assert.match(events[0].reason ?? "", /empty/);
});

test("addTag: rejects whitespace-only label", () => {
  const { writer, events } = captureAudit();
  assert.throws(
    () => addTag(makeCase(), makeTag({ label: "   " }), { audit: writer }),
    /must not be empty/
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].action, "TAG_REJECTED");
});

test("addTag: rejects duplicate by id", () => {
  const { writer, events } = captureAudit();
  const existing = makeTag({ id: "tag-1", label: "אחר", category: "CUSTOM" });
  const caseItem = makeCase({ tags: [existing] });
  const dup = makeTag({ id: "tag-1", label: "שונה", category: "DOMAIN" });

  assert.throws(() => addTag(caseItem, dup, { audit: writer }), /Duplicate tag/);
  assert.equal(events[0].action, "TAG_REJECTED");
  assert.match(events[0].reason ?? "", /Duplicate/);
});

test("addTag: rejects duplicate by label+category case-insensitive", () => {
  const { writer, events } = captureAudit();
  const existing = makeTag({ id: "tag-a", label: "Urgent", category: "URGENCY" });
  const caseItem = makeCase({ tags: [existing] });
  const dup = makeTag({ id: "tag-b", label: "URGENT", category: "URGENCY" });

  assert.throws(() => addTag(caseItem, dup, { audit: writer }), /Duplicate tag/);
  assert.equal(events[0].action, "TAG_REJECTED");
});

test("addTag: same label but different category is allowed", () => {
  const { writer, events } = captureAudit();
  const existing = makeTag({ id: "tag-a", label: "מיוחד", category: "URGENCY" });
  const caseItem = makeCase({ tags: [existing] });
  const other = makeTag({ id: "tag-b", label: "מיוחד", category: "DOMAIN" });

  const updated = addTag(caseItem, other, { audit: writer });
  assert.equal(updated.tags.length, 2);
  assert.equal(events[0].action, "TAG_ADDED");
});

// ─── removeTag ───────────────────────────────────────────────────────────────

test("removeTag: removes tag and audits TAG_REMOVED", () => {
  const { writer, events } = captureAudit();
  const tag = makeTag();
  const caseItem = makeCase({ tags: [tag] });

  const updated = removeTag(caseItem, "tag-1", { audit: writer });

  assert.equal(updated.tags.length, 0);
  assert.equal(caseItem.tags.length, 1); // input unchanged
  assert.notEqual(updated, caseItem);
  assert.equal(events.length, 1);
  assert.equal(events[0].action, "TAG_REMOVED");
  assert.equal(events[0].tagId, "tag-1");
});

test("removeTag: absent id returns same reference and writes no audit event", () => {
  const { writer, events } = captureAudit();
  const caseItem = makeCase({ tags: [makeTag()] });

  const result = removeTag(caseItem, "does-not-exist", { audit: writer });

  assert.equal(result, caseItem); // same reference
  assert.equal(events.length, 0);
});

// ─── filterCasesByTags ───────────────────────────────────────────────────────

test("filterCasesByTags: empty tagIds returns a copy of all cases", () => {
  const cases = [makeCase({ id: "a" }), makeCase({ id: "b" })];
  const result = filterCasesByTags(cases, { tagIds: [], mode: "OR" });

  assert.deepEqual(
    result.map((c) => c.id),
    ["a", "b"]
  );
  assert.notEqual(result, cases); // copy, not same reference
});

test("filterCasesByTags: AND requires every tag, OR requires at least one", () => {
  const t1 = makeTag({ id: "t1" });
  const t2 = makeTag({ id: "t2", label: "l2", category: "DOMAIN" });
  const both = makeCase({ id: "both", tags: [t1, t2] });
  const onlyOne = makeCase({ id: "one", tags: [t1] });
  const none = makeCase({ id: "none", tags: [] });
  const cases = [both, onlyOne, none];

  const andResult = filterCasesByTags(cases, { tagIds: ["t1", "t2"], mode: "AND" });
  assert.deepEqual(andResult.map((c) => c.id), ["both"]);

  const orResult = filterCasesByTags(cases, { tagIds: ["t1", "t2"], mode: "OR" });
  assert.deepEqual(orResult.map((c) => c.id), ["both", "one"]);
});

test("filterCasesByTags: maxPerCategory caps per category and keeps input order", () => {
  const u = (id: string) => makeTag({ id, category: "URGENCY", label: id });
  const c1 = makeCase({ id: "c1", tags: [u("uA")] });
  const c2 = makeCase({ id: "c2", tags: [u("uB")] });
  const c3 = makeCase({ id: "c3", tags: [u("uC")] });
  const cases = [c1, c2, c3];

  const result = filterCasesByTags(cases, {
    tagIds: ["uA", "uB", "uC"],
    mode: "OR",
    maxPerCategory: 2,
  });

  // First two in URGENCY category kept, in input order.
  assert.deepEqual(result.map((c) => c.id), ["c1", "c2"]);
});

test("filterCasesByTags: sortByPriority orders URGENT→LOW with updatedAt desc tie-break", () => {
  const t = makeTag({ id: "t1" });
  const low = makeCase({ id: "low", priority: "LOW", tags: [t] });
  const urgentOld = makeCase({
    id: "urgentOld",
    priority: "URGENT",
    updatedAt: "2026-01-01T00:00:00.000Z",
    tags: [t],
  });
  const urgentNew = makeCase({
    id: "urgentNew",
    priority: "URGENT",
    updatedAt: "2026-06-01T00:00:00.000Z",
    tags: [t],
  });
  const high = makeCase({ id: "high", priority: "HIGH", tags: [t] });
  // Deliberately shuffled input.
  const cases = [low, urgentOld, high, urgentNew];

  const result = filterCasesByTags(cases, {
    tagIds: ["t1"],
    mode: "OR",
    sortByPriority: true,
  });

  assert.deepEqual(result.map((c) => c.id), ["urgentNew", "urgentOld", "high", "low"]);
});

test("filterCasesByTags: never mutates input arrays", () => {
  const t = makeTag({ id: "t1" });
  const cases = [
    makeCase({ id: "a", priority: "LOW", tags: [t] }),
    makeCase({ id: "b", priority: "URGENT", tags: [t] }),
  ];
  const snapshot = cases.map((c) => c.id);

  filterCasesByTags(cases, { tagIds: ["t1"], mode: "OR", sortByPriority: true, maxPerCategory: 5 });

  assert.deepEqual(cases.map((c) => c.id), snapshot);
});

// ─── createJsonlAuditWriter ──────────────────────────────────────────────────

test("createJsonlAuditWriter: appends JSON lines that round-trip parse", () => {
  const scratch =
    "/tmp/claude-1000/-home-moti-projects-SmartCase/e3886fc3-8a7a-4818-8b28-93ad3f7ad241/scratchpad";
  const dir = mkdtempSync(join(scratch, "audit-test-"));
  const file = join(dir, "case-events.jsonl");
  try {
    const write = createJsonlAuditWriter(file);
    write({
      timestamp: "2026-01-01T00:00:00.000Z",
      action: "TAG_ADDED",
      caseId: "case-1",
      tagId: "tag-1",
      label: "דחוף",
    });
    write({
      timestamp: "2026-01-01T00:00:01.000Z",
      action: "TAG_REMOVED",
      caseId: "case-1",
      tagId: "tag-1",
      label: "דחוף",
    });

    const lines = readFileSync(file, "utf8").trim().split("\n");
    assert.equal(lines.length, 2);
    const parsed = lines.map((l) => JSON.parse(l));
    assert.equal(parsed[0].action, "TAG_ADDED");
    assert.equal(parsed[1].action, "TAG_REMOVED");
    assert.equal(parsed[0].label, "דחוף");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
