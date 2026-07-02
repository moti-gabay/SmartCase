"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/../auth";
import type { CaseStatus, Priority, TaskStatus } from "@/types";

async function requireUserId(): Promise<string> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) throw new Error("Unauthorized");
  return id;
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

export async function toggleTaskStatus(taskId: string) {
  await requireUserId();
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { status: true } });
  if (!task) throw new Error("Task not found");

  const completing = task.status !== "COMPLETED";
  await prisma.task.update({
    where: { id: taskId },
    data: {
      status: completing ? "COMPLETED" : "PENDING",
      completedAt: completing ? new Date() : null,
    },
  });

  revalidatePath("/tasks");
  revalidatePath("/dashboard");
}

const createTaskSchema = z.object({
  caseId: z.string().min(1),
  title: z.string().min(2),
  description: z.string().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]),
  dueDate: z.string().optional(),
  assignedToId: z.string().optional(),
});

export async function createTask(input: {
  caseId: string;
  title: string;
  description?: string;
  priority: Priority;
  dueDate?: string;
  assignedToId?: string;
}) {
  const userId = await requireUserId();
  const data = createTaskSchema.parse(input);

  await prisma.task.create({
    data: {
      caseId: data.caseId,
      title: data.title,
      description: data.description || null,
      priority: data.priority as Priority,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      assignedToId: data.assignedToId || null,
      createdById: userId,
      status: "PENDING",
    },
  });

  revalidatePath("/tasks");
  revalidatePath(`/cases/${data.caseId}`);
}

export async function setTaskStatus(taskId: string, status: TaskStatus) {
  await requireUserId();
  await prisma.task.update({
    where: { id: taskId },
    data: {
      status,
      completedAt: status === "COMPLETED" ? new Date() : null,
    },
  });
  revalidatePath("/tasks");
}

// ─── Case status ───────────────────────────────────────────────────────────────

export async function changeCaseStatus(caseId: string, newStatus: CaseStatus, reason?: string) {
  const userId = await requireUserId();
  const current = await prisma.case.findUnique({ where: { id: caseId }, select: { status: true } });
  if (!current) throw new Error("Case not found");
  if (current.status === newStatus) return;

  await prisma.$transaction([
    prisma.case.update({
      where: { id: caseId },
      data: {
        status: newStatus,
        ...(newStatus === "SUBMITTED" ? { submissionDate: new Date() } : {}),
        ...(newStatus === "CLOSED" ? { closedAt: new Date() } : {}),
      },
    }),
    prisma.caseStatusHistory.create({
      data: {
        caseId,
        changedById: userId,
        previousStatus: current.status,
        newStatus,
        reason: reason || null,
      },
    }),
  ]);

  revalidatePath(`/cases/${caseId}`);
  revalidatePath("/cases");
  revalidatePath("/dashboard");
}
