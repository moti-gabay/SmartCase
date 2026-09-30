// Structural policy for the assistant action registry (src/lib/ai/tools/registry.ts):
// every mutating action must be declared consistently, and the RBAC decisions
// taken for this layer (cascading deletes held above AGENT) are pinned here so
// a new domain cannot silently loosen them.
//
// Prisma / NextAuth / next/cache are mocked only so the real action modules
// load; no action is executed.

import { test, mock } from "node:test";
import assert from "node:assert/strict";

type Json = Record<string, unknown>;
type MockOptions = Parameters<typeof mock.module>[1];
const asExports = (exports: Json) => ({ exports }) as unknown as MockOptions;

mock.module("../src/lib/prisma.ts", asExports({ prisma: {} }));
mock.module("../auth.ts", asExports({ auth: async () => null }));
mock.module("next/cache", asExports({ revalidatePath: () => {} }));

const registry = () => import("../src/lib/ai/tools/registry");

const ALL = ["create_task", "update_task", "delete_task",
  "create_case", "update_case", "change_case_status", "delete_case", "add_case_tag", "remove_case_tag", "generate_portal_link",
  "create_client", "update_client", "delete_client",
  "create_slot", "book_slot", "reschedule_meeting", "cancel_meeting", "delete_slot",
  "generate_letter", "refine_letter", "analyze_document", "review_document", "delete_document",
  "commit_ai_summary",
  "approve_user", "suspend_user", "change_role", "delete_user"];

test("registry: every action is registered, and name == declaration name", async () => {
  const { getAction } = await registry();
  for (const name of ALL) {
    const def = getAction(name);
    assert.ok(def, `${name} missing`);
    assert.equal(def.declaration.name, name);
    assert.ok(def.roles.length > 0, `${name} has no roles`);
  }
});

test("registry: every DELETE is destructive; cascading deletes never reach AGENT", async () => {
  const { getAction } = await registry();
  for (const name of ALL) {
    const def = getAction(name)!;
    if (def.verb === "DELETE") assert.equal(def.destructive, true, `${name} must be destructive`);
  }
  for (const name of ["delete_case", "delete_client"]) {
    assert.deepEqual([...getAction(name)!.roles].sort(), ["ADMIN", "SUPERVISOR"], name);
  }
});

test("registry: declarations are role-filtered", async () => {
  const { getActionDeclarations, describeActions } = await registry();
  const agent = getActionDeclarations("AGENT").map((d) => d.name);
  const admin = getActionDeclarations("ADMIN").map((d) => d.name);
  assert.ok(!agent.includes("delete_case") && !agent.includes("delete_client"));
  assert.ok(admin.includes("delete_case") && admin.includes("delete_client"));
  assert.deepEqual(getActionDeclarations("CLIENT"), []);
  assert.ok(!describeActions("AGENT").includes("delete_client"));
});

test("registry: PII is never a model parameter — only card-typed", async () => {
  const { getAction } = await registry();
  const PII = ["nationalId", "phone", "email"];
  for (const name of ALL) {
    const props = Object.keys(getAction(name)!.declaration.parameters?.properties ?? {});
    for (const key of PII) assert.ok(!props.includes(key), `${name} exposes ${key} to the model`);
  }
  assert.ok(getAction("create_client")!.humanSchema, "create_client needs a humanSchema");
  assert.ok(getAction("update_client")!.humanSchema, "update_client needs a humanSchema");
});

test("registry: unknown and prototype names do not resolve", async () => {
  const { getAction, isActionTool } = await registry();
  for (const name of ["nope", "constructor", "toString", "__proto__"]) {
    assert.equal(getAction(name), undefined);
    assert.equal(isActionTool(name), false);
  }
});

test("registry: review_document refuses a rejection without a reason (model must ask)", async () => {
  const { getAction } = await registry();
  const schema = getAction("review_document")!.argsSchema;
  const base = { caseNumber: "SC-1", document: "ת\"ז" };
  assert.equal(schema.safeParse({ ...base, decision: "REJECTED" }).success, false);
  assert.equal(schema.safeParse({ ...base, decision: "REJECTED", reason: "מטושטש" }).success, true);
  assert.equal(schema.safeParse({ ...base, decision: "APPROVED" }).success, true);
});

test("registry: appointment args take Israel wall-clock HH:MM, not free text", async () => {
  const { getAction } = await registry();
  const schema = getAction("book_slot")!.argsSchema;
  assert.equal(schema.safeParse({ caseNumber: "SC-1", date: "2026-10-06", time: "10:00" }).success, true);
  assert.equal(schema.safeParse({ caseNumber: "SC-1", date: "2026-10-06", time: "10am" }).success, false);
  assert.equal(schema.safeParse({ caseNumber: "SC-1", date: "6/10", time: "10:00" }).success, false);
});

test("registry: user management is ADMIN-only and invisible to other roles", async () => {
  const { getAction, getActionDeclarations, describeActions } = await registry();
  const USER_TOOLS = ["approve_user", "suspend_user", "change_role", "delete_user"];
  for (const name of USER_TOOLS) assert.deepEqual([...getAction(name)!.roles], ["ADMIN"], name);
  for (const role of ["SUPERVISOR", "AGENT"]) {
    const names = getActionDeclarations(role).map((d) => d.name);
    for (const name of USER_TOOLS) assert.ok(!names.includes(name), `${role} sees ${name}`);
    assert.ok(!describeActions(role).includes("approve_user"));
  }
  assert.equal(getAction("delete_user")!.destructive, true);
});

test("registry: change_role cannot grant CLIENT or unknown roles", async () => {
  const { getAction } = await registry();
  const schema = getAction("change_role")!.argsSchema;
  assert.equal(schema.safeParse({ userName: "x", role: "SUPERVISOR" }).success, true);
  assert.equal(schema.safeParse({ userName: "x", role: "CLIENT" }).success, false);
  assert.equal(schema.safeParse({ userName: "x", role: "SUPERADMIN" }).success, false);
});

test("registry: toClientCard strips the server-only model args", async () => {
  const { toClientCard } = await import("../src/lib/ai/tools/registry");
  const card = {
    intentId: "i1", tool: "create_task", domain: "TASKS" as const, action: "CREATE" as const,
    summaryHebrew: "s", displayParams: [], destructive: false, expiresAt: "", status: "PENDING" as const,
    args: { caseNumber: "SC-1", title: "t" },
  };
  const out = toClientCard(card);
  assert.equal("args" in out, false);
  assert.equal(out.intentId, "i1");
  assert.ok("args" in card, "input card is not mutated");
});

test("registry: no model-facing tool can approve, confirm or execute an intent", async () => {
  // Approval is a click on the card → /api/ai/actions/execute. A tool that
  // could do it would let voice (or an injected instruction) approve itself.
  const { getActionDeclarations } = await registry();
  const { getToolDeclarations } = await import("../src/lib/ai/assistant-tools");
  for (const role of ["ADMIN", "SUPERVISOR", "AGENT"]) {
    const names = [...getToolDeclarations(role), ...getActionDeclarations(role)].map((d) => d.name ?? "");
    for (const name of names) {
      assert.ok(!/intent|proposal|execute|confirm|approve_action/.test(name), `${role}: ${name}`);
      const params = Object.keys(getActionDeclarations(role).find((d) => d.name === name)?.parameters?.properties ?? {});
      assert.ok(!params.includes("intentId"), `${name} takes an intentId`);
    }
  }
});

test("registry: JEV rule ids are unique per action and reasons are Hebrew", async () => {
  const { getAction } = await registry();
  const { evaluateJev } = await import("../src/lib/jev/engine");
  for (const name of ALL) {
    const ids = (getAction(name)!.jevRules ?? []).map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length, `${name} has duplicate JEV rule ids`);
  }
  // A blocking rule's reason must be user-facing Hebrew (it reaches the card/model).
  const db = { case: { findUnique: async () => ({ status: "SUBMITTED" }) } } as never;
  const r = await evaluateJev(getAction("delete_case")!.jevRules as never, { caseId: "c" }, { actor: { id: "u", role: "ADMIN" }, db, now: new Date() });
  assert.equal(r.status, "BLOCKED");
  assert.match(r.verdicts[0].reasonHebrew, /[\u0590-\u05FF]/);
});

test("registry: actions carrying a date or assignee param declare the matching JEV rule", async () => {
  // Structural guard: a new action with these fields cannot silently skip policy.
  const { getAction } = await registry();
  const need: Record<string, string[]> = {
    create_task: ["task.due_not_past", "assignee.approved"],
    update_task: ["task.due_not_past", "assignee.approved"],
    create_case: ["case.deadline_not_past", "assignee.approved"],
    update_case: ["case.deadline_not_past", "assignee.approved"],
    create_slot: ["slot.start_not_past"],
    delete_case: ["case.not_in_flight", "case.has_dependents"],
  };
  for (const [name, rules] of Object.entries(need)) {
    const ids = (getAction(name)!.jevRules ?? []).map((r) => r.id);
    for (const id of rules) assert.ok(ids.includes(id), `${name} missing ${id}`);
  }
});
