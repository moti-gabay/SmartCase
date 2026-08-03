// Task mutation engine: turns one validated staff intent (patch a task, delete
// a task) into the write that may actually happen.
//
// Same pure core + injected ports shape as
// src/lib/workflows/meeting-slot-management.ts — no Prisma import here, so
// every status transition and every authorization branch is unit-testable in
// isolation. The real wiring lives in the route handler.
//
// Two rules drive everything:
//  1. `completedAt` is *derived* from `status`, never accepted from the client.
//     Completing stamps it, leaving COMPLETED clears it — otherwise a reopened
//     task keeps a completion timestamp and every "completed on" reading lies.
//  2. Who may touch a task is decided here, from server-side identity only.
//     ADMIN/SUPERVISOR reach every task; an AGENT reaches only tasks they own
//     (created / assigned) or tasks on a case assigned to them.
//
// Refusals are *returned*, not thrown: the route maps a reason onto a status
// code, and a caller who lost a race (task already deleted) is a normal case.

import type { UpdateTaskInput } from "@/lib/schemas/task-schema";
import type { Priority, TaskStatus, UserRole } from "@/types";

// ── Types ─────────────────────────────────────────────────────────────────────

// The minimum a persisted task must expose for authorization + transition
// decisions. `caseAssignedAgentId` is joined off the parent case, not the task.
export interface ExistingTask {
  id: string;
  caseId: string;
  createdById: string;
  assignedToId: string | null;
  status: TaskStatus;
  completedAt: Date | null;
  caseAssignedAgentId: string | null;
}

export interface TaskActor {
  id: string;
  role: UserRole;
}

// The column patch the engine wants written — never includes client-supplied
// `completedAt`, which is always derived.
export interface TaskPatch {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: Priority;
  dueDate?: Date | null;
  assignedToId?: string | null;
  completedAt?: Date | null;
}

export interface TaskMutationResult {
  ok: boolean;
  reason?: string;
  patch?: TaskPatch;
  caseId?: string;
}

export const TASK_REASON_NOT_FOUND = "המשימה לא נמצאה";
export const TASK_REASON_FORBIDDEN = "אין הרשאה לערוך משימה זו";
export const TASK_REASON_NO_CHANGES = "לא התקבלו שדות לעדכון";
export const TASK_REASON_ASSIGNEE_NOT_FOUND = "המשתמש שנבחר אינו קיים";

// Roles that reach every task in the office, regardless of ownership.
const PRIVILEGED_ROLES: readonly UserRole[] = ["ADMIN", "SUPERVISOR"];

// ── Pure core ─────────────────────────────────────────────────────────────────

// Ownership is evaluated against server-side identity only — never a role or
// user id echoed back by the caller.
export function canMutateTask(actor: TaskActor, task: ExistingTask): boolean {
  if (PRIVILEGED_ROLES.includes(actor.role)) return true;
  return (
    task.createdById === actor.id ||
    task.assignedToId === actor.id ||
    task.caseAssignedAgentId === actor.id
  );
}

// `completedAt` follows `status`, in both directions:
//   → COMPLETED  : stamp `now` (keep an existing stamp so re-saving an already
//                  completed task does not rewrite history)
//   ← any other  : clear it
// Returns undefined when the transition leaves the column untouched, so an
// unrelated title edit never writes to it.
export function deriveCompletedAt(
  current: ExistingTask,
  nextStatus: TaskStatus | undefined,
  now: Date,
): Date | null | undefined {
  if (nextStatus === undefined || nextStatus === current.status) return undefined;
  if (nextStatus === "COMPLETED") return current.completedAt ?? now;
  return current.completedAt === null ? undefined : null;
}

// Builds the minimal patch: only fields the caller actually sent, and only
// where the value differs from what is already stored for the columns we can
// compare cheaply (status). `id` is stripped — it addresses the row, it is
// never a writable column.
export function buildTaskPatch(current: ExistingTask, input: UpdateTaskInput, now: Date): TaskPatch {
  const patch: TaskPatch = {};

  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description || null;
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.dueDate !== undefined) patch.dueDate = input.dueDate;
  if (input.assignedToId !== undefined) patch.assignedToId = input.assignedToId;
  if (input.status !== undefined) patch.status = input.status;

  const completedAt = deriveCompletedAt(current, input.status, now);
  if (completedAt !== undefined) patch.completedAt = completedAt;

  return patch;
}

// ── Ports ─────────────────────────────────────────────────────────────────────

export interface TaskPorts {
  // Returns null when the id does not exist, so the caller can tell "gone" from
  // "refused" — the authorization decision itself is core logic.
  findTask: (id: string) => Promise<ExistingTask | null>;
  // Existence check for a re-assignment target; skipped when the patch does not
  // touch `assignedToId` or clears it.
  assigneeExists: (userId: string) => Promise<boolean>;
  updateTask: (id: string, patch: TaskPatch) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
}

// ── Orchestrators ─────────────────────────────────────────────────────────────

// Resolves the task and runs the ownership gate. Shared by update and delete so
// the two can never drift apart on who is allowed to act.
async function authorize(
  id: string,
  actor: TaskActor,
  ports: TaskPorts,
): Promise<{ task: ExistingTask } | { reason: string }> {
  const task = await ports.findTask(id);
  if (!task) return { reason: TASK_REASON_NOT_FOUND };
  // Same generic refusal for "exists but not yours" as the route uses for a
  // plain 403 — an unauthorized caller learns nothing about the row.
  if (!canMutateTask(actor, task)) return { reason: TASK_REASON_FORBIDDEN };
  return { task };
}

export async function updateTask(
  input: UpdateTaskInput,
  actor: TaskActor,
  ports: TaskPorts,
  now: Date,
): Promise<TaskMutationResult> {
  const resolved = await authorize(input.id, actor, ports);
  if ("reason" in resolved) return { ok: false, reason: resolved.reason };

  const patch = buildTaskPatch(resolved.task, input, now);
  if (Object.keys(patch).length === 0) return { ok: false, reason: TASK_REASON_NO_CHANGES };

  // A dangling assignee would produce an opaque FK error at write time; check
  // it here so the caller gets a field-level reason instead.
  if (patch.assignedToId != null && !(await ports.assigneeExists(patch.assignedToId))) {
    return { ok: false, reason: TASK_REASON_ASSIGNEE_NOT_FOUND };
  }

  await ports.updateTask(resolved.task.id, patch);
  return { ok: true, patch, caseId: resolved.task.caseId };
}

export async function deleteTask(
  id: string,
  actor: TaskActor,
  ports: TaskPorts,
): Promise<TaskMutationResult> {
  const resolved = await authorize(id, actor, ports);
  if ("reason" in resolved) return { ok: false, reason: resolved.reason };

  // Task rows carry no dependents (no child relations in the schema), so
  // deletion is unconditional once ownership passes.
  await ports.deleteTask(resolved.task.id);
  return { ok: true, caseId: resolved.task.caseId };
}
