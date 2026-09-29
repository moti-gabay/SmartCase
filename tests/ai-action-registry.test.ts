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
  "create_client", "update_client", "delete_client"];

test("registry: every action is registered, and name == declaration name", async () => {
  const { getAction } = await registry();
  for (const name of ALL) {
    const def = getAction(name);
    assert.ok(def, `${name} missing`);
    assert.equal(def.declaration.name, name);
    assert.ok(def.roles.length > 0, `${name} has no roles`);
  }
});

test("registry: every DELETE is destructive and no destructive action reaches AGENT", async () => {
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
