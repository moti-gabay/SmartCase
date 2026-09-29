// Prisma wiring for the task mutation engine (task-management.ts). Shared by
// the staff task route and the assistant's task actions so both hit the exact
// same authorization + persistence path. Plain module — never "use server".
import { prisma } from "@/lib/prisma";
import type { TaskPorts } from "@/lib/workflows/task-management";

export function buildTaskPorts(): TaskPorts {
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
