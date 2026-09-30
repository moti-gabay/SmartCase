// JEV policy engine + rule factories (src/lib/jev/). Pure: a fake reader is
// passed as the db port, so no module mocks are needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateJev, toWarnings, unacknowledged, blockedReason, JEV_RULE_ERROR_REASON } from "../src/lib/jev/engine";
import { deadlineSoon, notInPast } from "../src/lib/jev/rules/dates";
import { MAX_OPEN_TASKS, assigneeApproved, assigneeLoad } from "../src/lib/jev/rules/assignee";
import { IN_FLIGHT_STATUSES, caseHasDependents, caseNotInFlight } from "../src/lib/jev/rules/cases";
import type { JevContext, JevReader, JevRule } from "../src/lib/jev/types";

const NOW = new Date("2026-10-01T09:00:00.000Z");
const fake = (o: Record<string, unknown> = {}) =>
  ({
    case: { findUnique: async () => o.case ?? null },
    user: { findUnique: async () => o.user ?? null },
    task: { count: async () => (o.tasks as number) ?? 0 },
    document: { count: async () => (o.docs as number) ?? 0 },
  }) as unknown as JevReader;
const ctx = (o: Record<string, unknown> = {}): JevContext => ({ actor: { id: "u1", role: "ADMIN" }, db: fake(o), now: NOW });

const block: JevRule<unknown> = { id: "b", evaluate: async () => ({ ruleId: "b", status: "BLOCKED", reasonHebrew: "חסום" }) };
const warn: JevRule<unknown> = {
  id: "w",
  evaluate: async () => ({ ruleId: "w", status: "WARNING_REQUIRES_ELEVATED_APPROVAL", reasonHebrew: "אזהרה" }),
};
const pass: JevRule<unknown> = { id: "p", evaluate: async () => null };

test("engine: no rules and passing rules are ALLOWED; evaluated ids are recorded", async () => {
  assert.equal((await evaluateJev(undefined, {}, ctx())).status, "ALLOWED");
  const r = await evaluateJev([pass], {}, ctx());
  assert.deepEqual([r.status, r.evaluated, r.verdicts], ["ALLOWED", ["p"], []]);
});

test("engine: BLOCKED beats WARNING beats ALLOWED", async () => {
  assert.equal((await evaluateJev([pass, warn], {}, ctx())).status, "WARNING_REQUIRES_ELEVATED_APPROVAL");
  const r = await evaluateJev([warn, block, pass], {}, ctx());
  assert.equal(r.status, "BLOCKED");
  assert.equal(r.verdicts.length, 2);
  assert.equal(blockedReason(r), "חסום");
});

test("engine: a throwing rule fails closed", async () => {
  const boom: JevRule<unknown> = { id: "boom", evaluate: async () => { throw new Error("db down"); } };
  const orig = console.error;
  console.error = () => {};
  const r = await evaluateJev([boom], {}, ctx());
  console.error = orig;
  assert.equal(r.status, "BLOCKED");
  assert.equal(r.verdicts[0].reasonHebrew, JEV_RULE_ERROR_REASON);
});

test("engine: acknowledgment is bound to the exact warning rule ids", async () => {
  const w = toWarnings(await evaluateJev([warn], {}, ctx()));
  assert.equal(unacknowledged(w, undefined).length, 1);
  assert.equal(unacknowledged(w, ["other"]).length, 1);
  assert.equal(unacknowledged(w, ["w"]).length, 0);
});

test("dates: notInPast uses the Israel calendar day", async () => {
  const rule = notInPast<{ d?: string }>("t", "מועד", (p) => p.d);
  assert.equal(await rule.evaluate({ d: "2026-10-01" }, ctx()), null); // today
  assert.equal(await rule.evaluate({}, ctx()), null);
  assert.equal((await rule.evaluate({ d: "2026-09-30" }, ctx()))?.status, "BLOCKED");
  assert.equal((await rule.evaluate({ d: "2026-10-01T08:59:00.000Z" }, ctx()))?.status, "BLOCKED");
  assert.equal(await rule.evaluate({ d: "2026-10-01T09:01:00.000Z" }, ctx()), null);
});

test("dates: deadlineSoon warns inside 48h only", async () => {
  const rule = deadlineSoon<{ d?: string }>("t", "מועד", (p) => p.d);
  assert.equal((await rule.evaluate({ d: "2026-10-02" }, ctx()))?.status, "WARNING_REQUIRES_ELEVATED_APPROVAL");
  assert.equal(await rule.evaluate({ d: "2026-10-05" }, ctx()), null);
  assert.equal(await rule.evaluate({ d: "2026-09-01" }, ctx()), null); // past is notInPast's job
  assert.equal((await rule.evaluate({ d: "2026-10-03T08:59:00.000Z" }, ctx()))?.status, "WARNING_REQUIRES_ELEVATED_APPROVAL");
  assert.equal(await rule.evaluate({ d: "2026-10-03T09:00:00.000Z" }, ctx()), null); // exactly 48h
});

test("assignee: only APPROVED users may be assigned; nullish ids are skipped", async () => {
  const rule = assigneeApproved<{ a?: string | null }>((p) => p.a);
  assert.equal(await rule.evaluate({ a: null }, ctx()), null);
  assert.equal(await rule.evaluate({ a: "u2" }, ctx({ user: { status: "APPROVED" } })), null);
  for (const user of [{ status: "SUSPENDED" }, { status: "PENDING_APPROVAL" }, null]) {
    assert.equal((await rule.evaluate({ a: "u2" }, ctx({ user })))?.status, "BLOCKED");
  }
});

test("assignee: load warns at exactly MAX_OPEN_TASKS", async () => {
  const rule = assigneeLoad<{ a?: string }>((p) => p.a);
  assert.equal(await rule.evaluate({ a: "u2" }, ctx({ tasks: MAX_OPEN_TASKS - 1 })), null);
  assert.equal((await rule.evaluate({ a: "u2" }, ctx({ tasks: MAX_OPEN_TASKS })))?.status, "WARNING_REQUIRES_ELEVATED_APPROVAL");
});

test("cases: delete is blocked for every in-flight status, allowed otherwise", async () => {
  for (const status of IN_FLIGHT_STATUSES) {
    assert.equal((await caseNotInFlight.evaluate({ caseId: "c" }, ctx({ case: { status } })))?.status, "BLOCKED", status);
  }
  for (const status of ["NEW_INTAKE", "GATHERING_DOCUMENTS", "REJECTED", "CLOSED"]) {
    assert.equal(await caseNotInFlight.evaluate({ caseId: "c" }, ctx({ case: { status } })), null, status);
  }
});

test("cases: dependents warn with counts, none is silent", async () => {
  assert.equal(await caseHasDependents.evaluate({ caseId: "c" }, ctx()), null);
  const v = await caseHasDependents.evaluate({ caseId: "c" }, ctx({ docs: 2, tasks: 3 }));
  assert.equal(v?.status, "WARNING_REQUIRES_ELEVATED_APPROVAL");
  assert.deepEqual(v?.metadata, { caseId: "c", documents: 2, openTasks: 3 });
});
