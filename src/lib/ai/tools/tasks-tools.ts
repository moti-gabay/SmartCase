// Tasks domain actions. Execution reuses the exact paths the UI uses:
// createTask (Server Action) for creation, and the task-management engine with
// the shared Prisma ports for edit/delete — so per-row ownership rules apply
// to the assistant identically.
import { Type } from "@google/genai";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createTask } from "@/lib/actions";
import { PRIORITY_LABELS, TASK_STATUS_LABELS } from "@/lib/constants";
import { TASK_PRIORITIES, TASK_STATUSES, updateTaskSchema } from "@/lib/schemas/task-schema";
import { deleteTask, updateTask } from "@/lib/workflows/task-management";
import { buildTaskPorts } from "@/lib/workflows/task-ports";
import { formatDay, parseDay } from "@/lib/ai/tools/intent";
import { resolveCase, resolveStaff, resolveTask } from "@/lib/ai/tools/resolve";
import type { ActionDefinition, DisplayParam } from "@/lib/ai/tools/types";

const STAFF = ["ADMIN", "SUPERVISOR", "AGENT"] as const;
const str = (description: string) => ({ type: Type.STRING, description });
const day = z.iso.date();
const text = (max: number) => z.string().trim().min(1).max(max);

function revalidateTask(caseId: string) {
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  revalidatePath(`/cases/${caseId}`);
}

// ─── create_task ─────────────────────────────────────────────────────────────

const createArgs = z.object({
  caseNumber: text(50),
  title: z.string().trim().min(2).max(200),
  description: text(2000).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueDate: day.optional(),
  assigneeName: text(100).optional(),
});
const createParams = z.object({
  caseId: z.string().min(1),
  title: z.string().min(2).max(200),
  description: z.string().max(2000).optional(),
  priority: z.enum(TASK_PRIORITIES),
  dueDate: day.optional(),
  assignedToId: z.string().min(1).optional(),
});

const createTaskAction: ActionDefinition<z.infer<typeof createParams>> = {
  name: "create_task",
  domain: "TASKS",
  verb: "CREATE",
  roles: STAFF,
  declaration: {
    name: "create_task",
    description: "הצעה ליצירת משימה חדשה בתיק. דורש אישור המשתמש לפני ביצוע.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        caseNumber: str("מספר התיק"),
        title: str("כותרת המשימה"),
        description: str("תיאור (אופציונלי)"),
        priority: str(`עדיפות, אחת מ: ${TASK_PRIORITIES.join(", ")} (ברירת מחדל MEDIUM)`),
        dueDate: str("תאריך יעד בפורמט YYYY-MM-DD"),
        assigneeName: str("שם העובד שהמשימה תשויך אליו"),
      },
      required: ["caseNumber", "title"],
    },
  },
  argsSchema: createArgs,
  paramsSchema: createParams,
  async resolve(raw) {
    const args = createArgs.parse(raw);
    const kase = await resolveCase(args.caseNumber);
    if ("error" in kase) return kase;
    const assignee = args.assigneeName ? await resolveStaff(args.assigneeName) : null;
    if (assignee && "error" in assignee) return assignee;
    const priority = args.priority ?? "MEDIUM";
    const display: DisplayParam[] = [
      ["תיק", kase.value.caseNumber],
      ["כותרת", args.title],
      ["עדיפות", PRIORITY_LABELS[priority]],
    ];
    if (args.description) display.push(["תיאור", args.description]);
    if (args.dueDate) display.push(["תאריך יעד", formatDay(parseDay(args.dueDate))]);
    if (assignee) display.push(["משויך ל", assignee.value.name]);
    return {
      params: {
        caseId: kase.value.id,
        title: args.title,
        description: args.description,
        priority,
        dueDate: args.dueDate,
        assignedToId: assignee?.value.id,
      },
      summaryHebrew: `יצירת משימה "${args.title}" בתיק ${kase.value.caseNumber}`,
      displayParams: display,
    };
  },
  async execute(p) {
    await createTask({ ...p, dueDate: p.dueDate ? parseDay(p.dueDate).toISOString() : undefined });
    return { ok: true, message: "המשימה נוצרה", entityHref: `/cases/${p.caseId}` };
  },
};

// ─── update_task (edit fields / change status / mark complete) ──────────────

const updateArgs = z.object({
  caseNumber: text(50),
  taskTitle: text(200),
  newTitle: z.string().trim().min(2).max(200).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueDate: z.union([day, z.literal("NONE")]).optional(),
  assigneeName: text(100).optional(),
});
const updateParams = z.object({
  taskId: z.string().min(1),
  caseId: z.string().min(1),
  title: z.string().min(2).max(200).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueDate: z.union([day, z.null()]).optional(),
  assignedToId: z.string().min(1).nullable().optional(),
});

const updateTaskAction: ActionDefinition<z.infer<typeof updateParams>> = {
  name: "update_task",
  domain: "TASKS",
  verb: "UPDATE",
  roles: STAFF,
  declaration: {
    name: "update_task",
    description:
      "הצעה לעדכון משימה קיימת: כותרת, סטטוס (כולל סימון כהושלמה), עדיפות, תאריך יעד או שיוך. דורש אישור המשתמש.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        caseNumber: str("מספר התיק שהמשימה שייכת אליו"),
        taskTitle: str("כותרת המשימה הקיימת (או חלק ממנה)"),
        newTitle: str("כותרת חדשה"),
        status: str(`סטטוס חדש, אחד מ: ${TASK_STATUSES.join(", ")}`),
        priority: str(`עדיפות חדשה, אחת מ: ${TASK_PRIORITIES.join(", ")}`),
        dueDate: str('תאריך יעד חדש YYYY-MM-DD, או "NONE" להסרה'),
        assigneeName: str("שם העובד לשיוך מחדש"),
      },
      required: ["caseNumber", "taskTitle"],
    },
  },
  argsSchema: updateArgs,
  paramsSchema: updateParams,
  async resolve(raw) {
    const args = updateArgs.parse(raw);
    const kase = await resolveCase(args.caseNumber);
    if ("error" in kase) return kase;
    const task = await resolveTask(kase.value.id, args.taskTitle);
    if ("error" in task) return task;
    const assignee = args.assigneeName ? await resolveStaff(args.assigneeName) : null;
    if (assignee && "error" in assignee) return assignee;

    const display: DisplayParam[] = [
      ["תיק", kase.value.caseNumber],
      ["משימה", task.value.title],
    ];
    if (args.newTitle) display.push(["כותרת חדשה", args.newTitle]);
    if (args.status) display.push(["סטטוס", TASK_STATUS_LABELS[args.status] ?? args.status]);
    if (args.priority) display.push(["עדיפות", PRIORITY_LABELS[args.priority]]);
    if (args.dueDate) display.push(["תאריך יעד", args.dueDate === "NONE" ? "ללא" : formatDay(parseDay(args.dueDate))]);
    if (assignee) display.push(["משויך ל", assignee.value.name]);
    if (display.length === 2) return { error: "לא צוין מה לעדכן במשימה" };

    return {
      params: {
        taskId: task.value.id,
        caseId: kase.value.id,
        title: args.newTitle,
        status: args.status,
        priority: args.priority,
        dueDate: args.dueDate === undefined ? undefined : args.dueDate === "NONE" ? null : args.dueDate,
        assignedToId: assignee?.value.id,
      },
      summaryHebrew:
        args.status === "COMPLETED" && display.length === 3
          ? `סימון המשימה "${task.value.title}" כהושלמה`
          : `עדכון המשימה "${task.value.title}" בתיק ${kase.value.caseNumber}`,
      displayParams: display,
    };
  },
  async execute(p, actor) {
    const input = updateTaskSchema.parse({
      id: p.taskId,
      ...(p.title !== undefined && { title: p.title }),
      ...(p.status !== undefined && { status: p.status }),
      ...(p.priority !== undefined && { priority: p.priority }),
      ...(p.dueDate !== undefined && { dueDate: p.dueDate === null ? null : parseDay(p.dueDate) }),
      ...(p.assignedToId !== undefined && { assignedToId: p.assignedToId }),
    });
    const result = await updateTask(input, actor, buildTaskPorts(), new Date());
    if (!result.ok) return { ok: false, message: result.reason ?? "העדכון נכשל" };
    revalidateTask(p.caseId);
    return { ok: true, message: "המשימה עודכנה", entityHref: `/cases/${p.caseId}` };
  },
};

// ─── delete_task ─────────────────────────────────────────────────────────────

const deleteArgs = z.object({ caseNumber: text(50), taskTitle: text(200) });
const deleteParams = z.object({ taskId: z.string().min(1), caseId: z.string().min(1) });

const deleteTaskAction: ActionDefinition<z.infer<typeof deleteParams>> = {
  name: "delete_task",
  domain: "TASKS",
  verb: "DELETE",
  roles: STAFF,
  destructive: true,
  declaration: {
    name: "delete_task",
    description: "הצעה למחיקת משימה מתיק. פעולה בלתי הפיכה — דורש אישור המשתמש.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        caseNumber: str("מספר התיק"),
        taskTitle: str("כותרת המשימה (או חלק ממנה)"),
      },
      required: ["caseNumber", "taskTitle"],
    },
  },
  argsSchema: deleteArgs,
  paramsSchema: deleteParams,
  async resolve(raw) {
    const args = deleteArgs.parse(raw);
    const kase = await resolveCase(args.caseNumber);
    if ("error" in kase) return kase;
    const task = await resolveTask(kase.value.id, args.taskTitle);
    if ("error" in task) return task;
    return {
      params: { taskId: task.value.id, caseId: kase.value.id },
      summaryHebrew: `מחיקת המשימה "${task.value.title}" מתיק ${kase.value.caseNumber}`,
      displayParams: [
        ["תיק", kase.value.caseNumber],
        ["משימה", task.value.title],
      ],
    };
  },
  async execute(p, actor) {
    const result = await deleteTask(p.taskId, actor, buildTaskPorts());
    if (!result.ok) return { ok: false, message: result.reason ?? "המחיקה נכשלה" };
    revalidateTask(p.caseId);
    return { ok: true, message: "המשימה נמחקה", entityHref: `/cases/${p.caseId}` };
  },
};

export const TASK_ACTIONS = [createTaskAction, updateTaskAction, deleteTaskAction];
