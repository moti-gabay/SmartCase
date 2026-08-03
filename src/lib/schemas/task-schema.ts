// Single source of truth for the task *mutation* input shapes (staff edit,
// staff delete). Creation still validates inline in src/lib/actions.ts — it
// predates this module and moving it is out of scope here.
//
// Update is a partial patch, not a full replacement: the edit modal sends only
// the fields the user touched, so every field is optional and `null` is a
// meaningful value (clear the due date / unassign) distinct from "absent"
// (leave untouched). That distinction is why `dueDate` and `assignedToId` are
// nullable rather than merely optional.

import { z } from "zod";

export const TASK_STATUSES = ["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;
export const TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

export const MAX_TASK_TITLE_LENGTH = 200;
export const MAX_TASK_DESCRIPTION_LENGTH = 2000;

const taskId = z.string().min(1).max(64);

// Accepts "YYYY-MM-DD" (the <input type="date"> value) and full ISO strings.
const dueDate = z
  .union([z.iso.date(), z.iso.datetime({ offset: true }), z.date()])
  .pipe(z.coerce.date())
  .nullable();

export const updateTaskSchema = z
  .object({
    id: taskId,
    title: z.string().trim().min(2, { message: "כותרת קצרה מדי" }).max(MAX_TASK_TITLE_LENGTH).optional(),
    description: z.string().trim().max(MAX_TASK_DESCRIPTION_LENGTH).nullable().optional(),
    status: z.enum(TASK_STATUSES).optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    dueDate: dueDate.optional(),
    assignedToId: z.string().min(1).max(64).nullable().optional(),
  })
  // An update that patches nothing is a client bug, not a no-op worth a write.
  .refine((input) => Object.keys(input).length > 1, { message: "לא התקבלו שדות לעדכון" });

export const deleteTaskSchema = z.object({
  id: taskId,
});

export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type DeleteTaskInput = z.infer<typeof deleteTaskSchema>;
