import { strict as assert } from "node:assert";
import { test } from "node:test";

import { updateTaskSchema, deleteTaskSchema } from "../src/lib/schemas/task-schema";
import {
  TASK_REASON_ASSIGNEE_NOT_FOUND,
  TASK_REASON_FORBIDDEN,
  TASK_REASON_NOT_FOUND,
  TASK_REASON_NO_CHANGES,
  buildTaskPatch,
  canMutateTask,
  deleteTask,
  deriveCompletedAt,
  updateTask,
  type ExistingTask,
  type TaskPorts,
} from "../src/lib/workflows/task-management";

const NOW = new Date("2026-08-03T10:00:00.000Z");

function task(overrides: Partial<ExistingTask> = {}): ExistingTask {
  return {
    id: "task-1",
    caseId: "case-1",
    createdById: "creator",
    assignedToId: null,
    status: "PENDING",
    completedAt: null,
    caseAssignedAgentId: null,
    ...overrides,
  };
}

function ports(overrides: Partial<TaskPorts> = {}): TaskPorts & { writes: unknown[] } {
  const writes: unknown[] = [];
  return {
    writes,
    findTask: async () => task(),
    assigneeExists: async () => true,
    updateTask: async (id, patch) => void writes.push({ op: "update", id, patch }),
    deleteTask: async (id) => void writes.push({ op: "delete", id }),
    ...overrides,
  };
}

// ── Schema ────────────────────────────────────────────────────────────────────

test("updateTaskSchema rejects a patch with no fields", () => {
  assert.equal(updateTaskSchema.safeParse({ id: "task-1" }).success, false);
});

test("updateTaskSchema rejects a too-short title and an unknown status", () => {
  assert.equal(updateTaskSchema.safeParse({ id: "task-1", title: "a" }).success, false);
  assert.equal(updateTaskSchema.safeParse({ id: "task-1", status: "DONE" }).success, false);
});

test("updateTaskSchema accepts a date-only dueDate and null to clear it", () => {
  const parsed = updateTaskSchema.parse({ id: "task-1", dueDate: "2026-09-01" });
  assert.equal(parsed.dueDate?.toISOString(), "2026-09-01T00:00:00.000Z");
  assert.equal(updateTaskSchema.parse({ id: "task-1", dueDate: null }).dueDate, null);
});

test("deleteTaskSchema requires a non-empty id", () => {
  assert.equal(deleteTaskSchema.safeParse({ id: "" }).success, false);
  assert.equal(deleteTaskSchema.parse({ id: "task-1" }).id, "task-1");
});

// ── Authorization ─────────────────────────────────────────────────────────────

test("privileged roles reach every task; an unrelated agent reaches none", () => {
  const row = task();
  assert.equal(canMutateTask({ id: "someone", role: "ADMIN" }, row), true);
  assert.equal(canMutateTask({ id: "someone", role: "SUPERVISOR" }, row), true);
  assert.equal(canMutateTask({ id: "someone", role: "AGENT" }, row), false);
});

test("an agent reaches a task they created, are assigned, or own the case of", () => {
  assert.equal(canMutateTask({ id: "creator", role: "AGENT" }, task()), true);
  assert.equal(canMutateTask({ id: "a", role: "AGENT" }, task({ assignedToId: "a" })), true);
  assert.equal(canMutateTask({ id: "a", role: "AGENT" }, task({ caseAssignedAgentId: "a" })), true);
});

test("a null assignee never matches a null-ish actor id", () => {
  assert.equal(canMutateTask({ id: "", role: "AGENT" }, task({ createdById: "creator" })), false);
});

// ── completedAt derivation ────────────────────────────────────────────────────

test("completing stamps completedAt, reopening clears it", () => {
  assert.deepEqual(deriveCompletedAt(task(), "COMPLETED", NOW), NOW);
  assert.equal(deriveCompletedAt(task({ status: "COMPLETED", completedAt: NOW }), "PENDING", NOW), null);
});

test("an unchanged status leaves completedAt untouched", () => {
  assert.equal(deriveCompletedAt(task(), undefined, NOW), undefined);
  assert.equal(deriveCompletedAt(task({ status: "PENDING" }), "PENDING", NOW), undefined);
});

test("re-completing an already completed task keeps the original stamp", () => {
  const earlier = new Date("2026-01-01T00:00:00.000Z");
  const row = task({ status: "IN_PROGRESS", completedAt: earlier });
  assert.equal(deriveCompletedAt(row, "COMPLETED", NOW), earlier);
});

// ── Patch building ────────────────────────────────────────────────────────────

test("buildTaskPatch carries only the fields sent and never the id", () => {
  const input = updateTaskSchema.parse({ id: "task-1", title: "כותרת חדשה" });
  const patch = buildTaskPatch(task(), input, NOW);
  assert.deepEqual(patch, { title: "כותרת חדשה" });
});

test("buildTaskPatch normalizes an empty description to null and clears a due date", () => {
  const input = updateTaskSchema.parse({ id: "task-1", description: "", dueDate: null });
  assert.deepEqual(buildTaskPatch(task(), input, NOW), { description: null, dueDate: null });
});

test("buildTaskPatch derives completedAt alongside a status change", () => {
  const input = updateTaskSchema.parse({ id: "task-1", status: "COMPLETED" });
  assert.deepEqual(buildTaskPatch(task(), input, NOW), { status: "COMPLETED", completedAt: NOW });
});

// ── Orchestrators ─────────────────────────────────────────────────────────────

test("updateTask refuses an unknown task without writing", async () => {
  const p = ports({ findTask: async () => null });
  const result = await updateTask(
    updateTaskSchema.parse({ id: "gone", title: "שלום" }),
    { id: "creator", role: "ADMIN" },
    p,
    NOW,
  );
  assert.deepEqual(result, { ok: false, reason: TASK_REASON_NOT_FOUND });
  assert.equal(p.writes.length, 0);
});

test("updateTask refuses an unauthorized agent without writing", async () => {
  const p = ports();
  const result = await updateTask(
    updateTaskSchema.parse({ id: "task-1", title: "שלום" }),
    { id: "intruder", role: "AGENT" },
    p,
    NOW,
  );
  assert.deepEqual(result, { ok: false, reason: TASK_REASON_FORBIDDEN });
  assert.equal(p.writes.length, 0);
});

test("a no-op status re-save patches status only, never completedAt", async () => {
  const p = ports();
  const result = await updateTask(
    updateTaskSchema.parse({ id: "task-1", status: "PENDING" }),
    { id: "creator", role: "AGENT" },
    p,
    NOW,
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.patch, { status: "PENDING" });
});

// The schema's refine already rejects a field-less patch, so this branch only
// fires for a direct engine caller — it is the engine's own guard, not the
// route's, and must hold independently.
test("updateTask refuses an empty patch without writing", async () => {
  const p = ports();
  const result = await updateTask(
    { id: "task-1" } as Parameters<typeof updateTask>[0],
    { id: "creator", role: "ADMIN" },
    p,
    NOW,
  );
  assert.deepEqual(result, { ok: false, reason: TASK_REASON_NO_CHANGES });
  assert.equal(p.writes.length, 0);
});

test("updateTask refuses a dangling assignee before writing", async () => {
  const p = ports({ assigneeExists: async () => false });
  const result = await updateTask(
    updateTaskSchema.parse({ id: "task-1", assignedToId: "ghost" }),
    { id: "creator", role: "ADMIN" },
    p,
    NOW,
  );
  assert.deepEqual(result, { ok: false, reason: TASK_REASON_ASSIGNEE_NOT_FOUND });
  assert.equal(p.writes.length, 0);
});

test("updateTask does not check existence when unassigning", async () => {
  let checked = false;
  const p = ports({ assigneeExists: async () => ((checked = true), true) });
  const result = await updateTask(
    updateTaskSchema.parse({ id: "task-1", assignedToId: null }),
    { id: "creator", role: "ADMIN" },
    p,
    NOW,
  );
  assert.equal(result.ok, true);
  assert.equal(checked, false);
});

test("updateTask writes the derived patch and reports the case id", async () => {
  const p = ports();
  const result = await updateTask(
    updateTaskSchema.parse({ id: "task-1", status: "COMPLETED", title: "סיום" }),
    { id: "creator", role: "AGENT" },
    p,
    NOW,
  );
  assert.equal(result.ok, true);
  assert.equal(result.caseId, "case-1");
  assert.deepEqual(p.writes, [
    { op: "update", id: "task-1", patch: { title: "סיום", status: "COMPLETED", completedAt: NOW } },
  ]);
});

test("deleteTask refuses an unknown task and an unauthorized agent", async () => {
  const missing = ports({ findTask: async () => null });
  assert.deepEqual(await deleteTask("gone", { id: "x", role: "ADMIN" }, missing), {
    ok: false,
    reason: TASK_REASON_NOT_FOUND,
  });
  assert.equal(missing.writes.length, 0);

  const guarded = ports();
  assert.deepEqual(await deleteTask("task-1", { id: "intruder", role: "AGENT" }, guarded), {
    ok: false,
    reason: TASK_REASON_FORBIDDEN,
  });
  assert.equal(guarded.writes.length, 0);
});

test("deleteTask removes an authorized task", async () => {
  const p = ports();
  const result = await deleteTask("task-1", { id: "creator", role: "AGENT" }, p);
  assert.deepEqual(result, { ok: true, caseId: "case-1" });
  assert.deepEqual(p.writes, [{ op: "delete", id: "task-1" }]);
});
