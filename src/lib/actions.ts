"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/../auth";
import type { CaseStatus, CaseType, Priority, TaskStatus, Gender, EmploymentStatus } from "@/types";

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

// ─── Create case ───────────────────────────────────────────────────────────────

const CASE_TYPES = [
  "DISABILITY_PENSION", "GENERAL_DISABILITY_ALLOWANCE", "MOBILITY_ALLOWANCE",
  "INCOME_SUPPORT", "LONG_TERM_CARE", "SURVIVORS_BENEFIT", "WORK_ACCIDENT",
  "OCCUPATIONAL_DISEASE", "APPEAL", "OTHER",
] as const;

const newClientSchema = z.object({
  fullName: z.string().min(2),
  nationalId: z.string().min(5),
  dateOfBirth: z.string().min(4),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]),
  phone: z.string().min(3),
  email: z.string().email().optional().or(z.literal("")),
  addressCity: z.string().optional(),
  employmentStatus: z.enum(["EMPLOYED", "SELF_EMPLOYED", "UNEMPLOYED", "RETIRED", "STUDENT", "UNABLE_TO_WORK"]).optional(),
  primaryCondition: z.string().optional(),
});

const createCaseSchema = z.object({
  clientMode: z.enum(["existing", "new"]),
  existingClientId: z.string().optional(),
  newClient: newClientSchema.optional(),
  caseType: z.enum(CASE_TYPES),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]),
  claimedPercentage: z.number().int().min(0).max(100).optional(),
  claimDescription: z.string().optional(),
  submissionDeadline: z.string().optional(),
  assignedAgentId: z.string().optional(),
});

export type CreateCaseInput = z.infer<typeof createCaseSchema>;

async function nextCaseNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `SC-${year}-`;
  const last = await prisma.case.findFirst({
    where: { caseNumber: { startsWith: prefix } },
    orderBy: { caseNumber: "desc" },
    select: { caseNumber: true },
  });
  const lastSeq = last ? parseInt(last.caseNumber.slice(prefix.length), 10) || 0 : 0;
  return `${prefix}${String(lastSeq + 1).padStart(5, "0")}`;
}

export async function createCase(input: CreateCaseInput): Promise<{ id: string }> {
  const userId = await requireUserId();
  const data = createCaseSchema.parse(input);

  // Resolve the client (existing or newly created).
  let clientId: string;
  if (data.clientMode === "existing") {
    if (!data.existingClientId) throw new Error("יש לבחור לקוח");
    clientId = data.existingClientId;
  } else {
    const nc = newClientSchema.parse(data.newClient);
    const exists = await prisma.client.findUnique({ where: { nationalId: nc.nationalId }, select: { id: true } });
    if (exists) throw new Error("לקוח עם תעודת זהות זו כבר קיים במערכת");
    const created = await prisma.client.create({
      data: {
        fullName: nc.fullName,
        nationalId: nc.nationalId,
        dateOfBirth: new Date(nc.dateOfBirth),
        gender: nc.gender as Gender,
        phone: nc.phone,
        email: nc.email || null,
        addressCity: nc.addressCity || null,
        employmentStatus: (nc.employmentStatus ?? "UNEMPLOYED") as EmploymentStatus,
        primaryCondition: nc.primaryCondition || null,
      },
      select: { id: true },
    });
    clientId = created.id;
  }

  const caseNumber = await nextCaseNumber();
  const templates = await prisma.documentChecklistTemplate.findMany({
    where: { caseType: data.caseType as CaseType },
    select: { id: true },
  });

  const created = await prisma.case.create({
    data: {
      caseNumber,
      clientId,
      createdById: userId,
      assignedAgentId: data.assignedAgentId || null,
      caseType: data.caseType as CaseType,
      priority: data.priority as Priority,
      status: "NEW_INTAKE",
      claimedPercentage: data.claimedPercentage ?? null,
      claimDescription: data.claimDescription || null,
      submissionDeadline: data.submissionDeadline ? new Date(data.submissionDeadline) : null,
      hasMissingDocuments: templates.length > 0,
      statusHistory: {
        create: { changedById: userId, previousStatus: null, newStatus: "NEW_INTAKE" },
      },
      ...(templates.length > 0
        ? { checklist: { create: templates.map((t) => ({ templateId: t.id, status: "MISSING" as const })) } }
        : {}),
    },
    select: { id: true },
  });

  revalidatePath("/cases");
  revalidatePath("/dashboard");
  revalidatePath("/clients");
  return { id: created.id };
}

// ─── Update / delete client ─────────────────────────────────────────────────

const updateClientSchema = z.object({
  fullName: z.string().min(2),
  nationalId: z.string().min(5),
  dateOfBirth: z.string().min(4),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]),
  phone: z.string().min(3),
  email: z.string().email().optional().or(z.literal("")),
  addressStreet: z.string().optional(),
  addressCity: z.string().optional(),
  addressZip: z.string().optional(),
  employmentStatus: z.enum(["EMPLOYED", "SELF_EMPLOYED", "UNEMPLOYED", "RETIRED", "STUDENT", "UNABLE_TO_WORK"]),
  employer: z.string().optional(),
  monthlyIncome: z.number().nonnegative().optional(),
  spouseIncome: z.number().nonnegative().optional(),
  spouseName: z.string().optional(),
  primaryCondition: z.string().optional(),
  icdCode: z.string().optional(),
  recognizedPercentage: z.number().int().min(0).max(100).optional(),
  diagnosisDate: z.string().optional(),
  treatingPhysician: z.string().optional(),
  internalNotes: z.string().optional(),
  isActive: z.boolean().optional(),
});

export type UpdateClientInput = z.infer<typeof updateClientSchema>;

export async function updateClient(id: string, input: UpdateClientInput) {
  await requireUserId();
  const data = updateClientSchema.parse(input);

  const conflict = await prisma.client.findFirst({
    where: { nationalId: data.nationalId, id: { not: id } },
    select: { id: true },
  });
  if (conflict) throw new Error("לקוח אחר עם תעודת זהות זו כבר קיים במערכת");

  await prisma.client.update({
    where: { id },
    data: {
      fullName: data.fullName,
      nationalId: data.nationalId,
      dateOfBirth: new Date(data.dateOfBirth),
      gender: data.gender as Gender,
      phone: data.phone,
      email: data.email || null,
      addressStreet: data.addressStreet || null,
      addressCity: data.addressCity || null,
      addressZip: data.addressZip || null,
      employmentStatus: data.employmentStatus as EmploymentStatus,
      employer: data.employer || null,
      monthlyIncome: data.monthlyIncome ?? null,
      spouseIncome: data.spouseIncome ?? null,
      spouseName: data.spouseName || null,
      primaryCondition: data.primaryCondition || null,
      icdCode: data.icdCode || null,
      recognizedPercentage: data.recognizedPercentage ?? null,
      diagnosisDate: data.diagnosisDate ? new Date(data.diagnosisDate) : null,
      treatingPhysician: data.treatingPhysician || null,
      internalNotes: data.internalNotes || null,
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
    },
  });

  revalidatePath("/clients");
  revalidatePath(`/clients/${id}`);
}

export async function deleteClient(id: string) {
  await requireUserId();
  // The Client→Case relation has no DB cascade, so remove the client's cases
  // first (their children cascade), then the client itself.
  await prisma.$transaction([
    prisma.case.deleteMany({ where: { clientId: id } }),
    prisma.client.delete({ where: { id } }),
  ]);

  revalidatePath("/clients");
  revalidatePath("/cases");
  revalidatePath("/dashboard");
}

// ─── Update / delete case ─────────────────────────────────────────────────────

const updateCaseSchema = z.object({
  caseType: z.enum(CASE_TYPES),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]),
  claimedPercentage: z.number().int().min(0).max(100).optional(),
  claimDescription: z.string().optional(),
  authorityReferenceNumber: z.string().optional(),
  submissionDeadline: z.string().optional(),
  nextFollowUpDate: z.string().optional(),
  assignedAgentId: z.string().optional(),
});

export type UpdateCaseInput = z.infer<typeof updateCaseSchema>;

export async function updateCase(id: string, input: UpdateCaseInput) {
  await requireUserId();
  const data = updateCaseSchema.parse(input);

  await prisma.case.update({
    where: { id },
    data: {
      caseType: data.caseType as CaseType,
      priority: data.priority as Priority,
      claimedPercentage: data.claimedPercentage ?? null,
      claimDescription: data.claimDescription || null,
      authorityReferenceNumber: data.authorityReferenceNumber || null,
      submissionDeadline: data.submissionDeadline ? new Date(data.submissionDeadline) : null,
      nextFollowUpDate: data.nextFollowUpDate ? new Date(data.nextFollowUpDate) : null,
      assignedAgentId: data.assignedAgentId || null,
    },
  });

  revalidatePath(`/cases/${id}`);
  revalidatePath("/cases");
  revalidatePath("/dashboard");
}

export async function deleteCase(id: string) {
  await requireUserId();
  // Case children (documents, notes, tasks, status history, checklist) cascade.
  await prisma.case.delete({ where: { id } });

  revalidatePath("/cases");
  revalidatePath("/clients");
  revalidatePath("/dashboard");
}

// ─── Delete document ───────────────────────────────────────────────────────────

export async function deleteDocument(id: string) {
  await requireUserId();
  const doc = await prisma.document.findUnique({ where: { id }, select: { caseId: true } });
  if (!doc) throw new Error("המסמך לא נמצא");

  // Reset any checklist item that pointed at this document back to MISSING.
  await prisma.caseChecklist.updateMany({
    where: { documentId: id },
    data: { status: "MISSING", documentId: null },
  });
  await prisma.document.delete({ where: { id } });

  const stillMissing = await prisma.caseChecklist.count({
    where: { caseId: doc.caseId, status: { in: ["MISSING", "REJECTED"] } },
  });
  await prisma.case.update({ where: { id: doc.caseId }, data: { hasMissingDocuments: stillMissing > 0 } });

  revalidatePath(`/cases/${doc.caseId}`);
  revalidatePath("/documents");
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
