import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/../auth";
import { prisma } from "@/lib/prisma";
import { deleteTaskSchema, updateTaskSchema } from "@/lib/schemas/task-schema";
import {
  TASK_REASON_FORBIDDEN,
  TASK_REASON_NOT_FOUND,
  deleteTask,
  updateTask,
  type TaskActor,
  type TaskPorts,
} from "@/lib/workflows/task-management";
import type { UserRole } from "@/types";

// Staff-only task mutation: edit a task's fields (PATCH) or remove it (DELETE).
//
// The task id comes from the route segment, never from the body — a body id
// would let a caller address one row while the URL (and any log line) named
// another. The actor comes from the session only; a role or user id in the
// payload is ignored outright.
//
// Ownership is not decided here: the engine in
// src/lib/workflows/task-management.ts owns that rule, and this file only maps
// its refusal reason onto a status code. Creation stays a Server Action
// (createTask) — this route exists because edit/delete need per-row
// authorization that the shared action layer does not express.

const STAFF_ROLES: readonly UserRole[] = ["ADMIN", "SUPERVISOR", "AGENT"];

// One generic message for every validation failure — Zod's issue list names
// internal field paths and bounds, which would leak the API shape.
const INVALID = "הנתונים שהתקבלו אינם תקינים";

// Returns the actor, or the rejection response for a non-staff caller.
async function resolveActor(): Promise<{ actor: TaskActor } | { denied: NextResponse }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { denied: NextResponse.json({ error: "לא מורשה" }, { status: 401 }) };
  }
  const role = session.user.role as UserRole;
  if (!STAFF_ROLES.includes(role)) {
    return { denied: NextResponse.json({ error: "אין הרשאה" }, { status: 403 }) };
  }
  return { actor: { id: session.user.id, role } };
}

function buildPorts(): TaskPorts {
  return {
    findTask: async (id) => {
      const row = await prisma.task.findUnique({
        where: { id },
        select: {
          id: true,
          caseId: true,
          createdById: true,
          assignedToId: true,
          status: true,
          completedAt: true,
          case: { select: { assignedAgentId: true } },
        },
      });
      if (!row) return null;
      return {
        id: row.id,
        caseId: row.caseId,
        createdById: row.createdById,
        assignedToId: row.assignedToId,
        status: row.status,
        completedAt: row.completedAt,
        caseAssignedAgentId: row.case.assignedAgentId,
      };
    },
    assigneeExists: async (userId) =>
      (await prisma.user.count({ where: { id: userId } })) > 0,
    updateTask: async (id, patch) => {
      await prisma.task.update({ where: { id }, data: patch });
    },
    deleteTask: async (id) => {
      await prisma.task.delete({ where: { id } });
    },
  };
}

// NOT_FOUND → 404, every other refusal → 403/400. A caller who may not touch
// the row never learns whether it exists.
function refusal(reason: string | undefined): NextResponse {
  if (reason === TASK_REASON_NOT_FOUND) return NextResponse.json({ error: reason }, { status: 404 });
  if (reason === TASK_REASON_FORBIDDEN) return NextResponse.json({ error: reason }, { status: 403 });
  return NextResponse.json({ error: reason ?? INVALID }, { status: 400 });
}

function revalidate(caseId: string | undefined) {
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  if (caseId) revalidatePath(`/cases/${caseId}`);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const resolved = await resolveActor();
  if ("denied" in resolved) return resolved.denied;

  const { taskId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: INVALID }, { status: 400 });
  }

  // The route segment wins over anything in the body.
  const payload = { ...(typeof body === "object" && body !== null ? body : {}), id: taskId };
  const parsed = updateTaskSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: INVALID }, { status: 400 });

  try {
    const result = await updateTask(parsed.data, resolved.actor, buildPorts(), new Date());
    if (!result.ok) return refusal(result.reason);

    revalidate(result.caseId);
    return NextResponse.json({ id: taskId, updated: Object.keys(result.patch ?? {}) });
  } catch (err) {
    console.error("[tasks/:id:PATCH]", err);
    return NextResponse.json({ error: "עדכון המשימה נכשל" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const resolved = await resolveActor();
  if ("denied" in resolved) return resolved.denied;

  const { taskId } = await params;
  const parsed = deleteTaskSchema.safeParse({ id: taskId });
  if (!parsed.success) return NextResponse.json({ error: INVALID }, { status: 400 });

  try {
    const result = await deleteTask(parsed.data.id, resolved.actor, buildPorts());
    if (!result.ok) return refusal(result.reason);

    revalidate(result.caseId);
    return NextResponse.json({ deleted: taskId });
  } catch (err) {
    console.error("[tasks/:id:DELETE]", err);
    return NextResponse.json({ error: "מחיקת המשימה נכשלה" }, { status: 500 });
  }
}
