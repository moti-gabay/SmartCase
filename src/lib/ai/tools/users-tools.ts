// User-management actions — ADMIN only, at proposal AND at execution (the
// execute route re-checks the current role). Execution goes through the admin
// Server Actions, which own the self-lockout / last-admin / referential guards
// and write the USER_UPDATE / USER_DELETE audit rows. The same guards are
// pre-checked in resolve only so a card that would certainly fail is never
// shown; the actions remain the enforcement point.
import { Type } from "@google/genai";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { adminDeleteUser, adminUpdateUser, approveUser, suspendUser } from "@/lib/actions";
import { USER_ROLE_LABELS, USER_STATUS_LABELS } from "@/lib/constants";
import { formatDay } from "@/lib/ai/tools/intent";
import { resolveUser } from "@/lib/ai/tools/resolve";
import type { ActionActor, ActionDefinition } from "@/lib/ai/tools/types";

const ADMIN_ONLY = ["ADMIN"] as const;
const STAFF_ROLES = ["ADMIN", "SUPERVISOR", "AGENT"] as const;

const str = (description: string) => ({ type: Type.STRING, description });
const userArgs = z.object({ userName: z.string().trim().min(1).max(100) });
const userParams = z.object({ userId: z.string().min(1) });
const USERS_HREF = "/admin/users";

const describeUser = (u: { name: string; role: string; status: string; createdAt: Date }) =>
  `${u.name} (${USER_ROLE_LABELS[u.role] ?? u.role}, ${USER_STATUS_LABELS[u.status] ?? u.status}, הצטרף ${formatDay(u.createdAt)})`;

type Target = { id: string; name: string; role: string; status: string };

// Mirrors adminUpdateUser: an approved admin losing admin access must not be
// the actor themself, nor the last approved admin.
async function adminLossRefusal(target: Target, nextRole: string, nextStatus: string, actor: ActionActor) {
  const losesAdmin =
    target.role === "ADMIN" && target.status === "APPROVED" && (nextRole !== "ADMIN" || nextStatus !== "APPROVED");
  if (!losesAdmin) return null;
  if (target.id === actor.id) return "לא ניתן לבטל את הרשאות המנהל של עצמך";
  const others = await prisma.user.count({ where: { role: "ADMIN", status: "APPROVED", id: { not: target.id } } });
  return others === 0 ? "לא ניתן להסיר את מנהל המערכת המאושר האחרון" : null;
}

function statusAction(opts: {
  name: string;
  status: "APPROVED" | "SUSPENDED";
  description: string;
  verbHe: string;
  run: (userId: string) => Promise<unknown>;
  message: string;
}): ActionDefinition<z.infer<typeof userParams>> {
  return {
    name: opts.name,
    domain: "USERS",
    verb: "UPDATE",
    roles: ADMIN_ONLY,
    declaration: {
      name: opts.name,
      description: opts.description,
      parameters: { type: Type.OBJECT, properties: { userName: str("שם המשתמש") }, required: ["userName"] },
    },
    argsSchema: userArgs,
    paramsSchema: userParams,
    async resolve(raw, actor) {
      const args = userArgs.parse(raw);
      const user = await resolveUser(args.userName, describeUser);
      if ("error" in user) return user;
      const target = user.value;
      if (target.status === opts.status) {
        return { error: `המשתמש כבר בסטטוס ${USER_STATUS_LABELS[opts.status]}` };
      }
      const refusal = await adminLossRefusal(target, target.role, opts.status, actor);
      if (refusal) return { error: refusal };
      return {
        params: { userId: target.id },
        summaryHebrew: `${opts.verbHe} המשתמש ${target.name}`,
        displayParams: [
          ["משתמש", target.name],
          ["תפקיד", USER_ROLE_LABELS[target.role] ?? target.role],
          ["סטטוס נוכחי", USER_STATUS_LABELS[target.status] ?? target.status],
          ["סטטוס חדש", USER_STATUS_LABELS[opts.status]],
        ],
      };
    },
    async execute(p) {
      await opts.run(p.userId);
      return { ok: true, message: opts.message, entityHref: USERS_HREF };
    },
  };
}

const approveUserAction = statusAction({
  name: "approve_user",
  status: "APPROVED",
  description: "הצעה לאישור חשבון משתמש (בדרך כלל נרשם חדש שממתין לאישור). מנהלים בלבד. דורש אישור.",
  verbHe: "אישור",
  run: approveUser,
  message: "המשתמש אושר",
});

const suspendUserAction = statusAction({
  name: "suspend_user",
  status: "SUSPENDED",
  description:
    "הצעה להשעיית משתמש — חוסם כניסה ומנתק את החיבור הפעיל תוך דקות. זו הדרך המומלצת להסרת עובד עם היסטוריה. מנהלים בלבד. דורש אישור.",
  verbHe: "השעיית",
  run: suspendUser,
  message: "המשתמש הושעה",
});

// ─── change_role ─────────────────────────────────────────────────────────────

const roleArgs = z.object({ userName: z.string().trim().min(1).max(100), role: z.enum(STAFF_ROLES) });
const roleParams = z.object({ userId: z.string().min(1), role: z.enum(STAFF_ROLES) });

const changeRoleAction: ActionDefinition<z.infer<typeof roleParams>> = {
  name: "change_role",
  domain: "USERS",
  verb: "UPDATE",
  roles: ADMIN_ONLY,
  declaration: {
    name: "change_role",
    description: "הצעה לשינוי תפקיד משתמש (ADMIN / SUPERVISOR / AGENT). מנהלים בלבד. דורש אישור.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        userName: str("שם המשתמש"),
        role: str(`תפקיד חדש, אחד מ: ${STAFF_ROLES.join(", ")}`),
      },
      required: ["userName", "role"],
    },
  },
  argsSchema: roleArgs,
  paramsSchema: roleParams,
  async resolve(raw, actor) {
    const args = roleArgs.parse(raw);
    const user = await resolveUser(args.userName, describeUser);
    if ("error" in user) return user;
    const target = user.value;
    if (target.role === args.role) return { error: `המשתמש כבר בתפקיד ${USER_ROLE_LABELS[args.role]}` };
    const refusal = await adminLossRefusal(target, args.role, target.status, actor);
    if (refusal) return { error: refusal };
    return {
      params: { userId: target.id, role: args.role },
      summaryHebrew: `שינוי תפקיד של ${target.name} ל${USER_ROLE_LABELS[args.role]}`,
      displayParams: [
        ["משתמש", target.name],
        ["תפקיד נוכחי", USER_ROLE_LABELS[target.role] ?? target.role],
        ["תפקיד חדש", USER_ROLE_LABELS[args.role]],
      ],
    };
  },
  async execute(p) {
    await adminUpdateUser(p.userId, { role: p.role });
    return { ok: true, message: "התפקיד עודכן", entityHref: USERS_HREF };
  },
};

// ─── delete_user ─────────────────────────────────────────────────────────────

const deleteUserAction: ActionDefinition<z.infer<typeof userParams>> = {
  name: "delete_user",
  domain: "USERS",
  verb: "DELETE",
  roles: ADMIN_ONLY,
  destructive: true,
  declaration: {
    name: "delete_user",
    description:
      "הצעה למחיקת משתמש לצמיתות — רק לחשבון ללא היסטוריית פעילות (למשל הרשמה לא רלוונטית). לעובד עם היסטוריה השתמש ב-suspend_user. מנהלים בלבד. דורש אישור.",
    parameters: { type: Type.OBJECT, properties: { userName: str("שם המשתמש") }, required: ["userName"] },
  },
  argsSchema: userArgs,
  paramsSchema: userParams,
  async resolve(raw, actor) {
    const args = userArgs.parse(raw);
    const user = await resolveUser(args.userName, describeUser);
    if ("error" in user) return user;
    const target = user.value;
    if (target.id === actor.id) return { error: "לא ניתן למחוק את המשתמש שלך" };
    const refusal = await adminLossRefusal(target, "DELETED", "DELETED", actor);
    if (refusal) return { error: refusal };
    const [cases, notes, tasks, history] = await Promise.all([
      prisma.case.count({ where: { createdById: target.id } }),
      prisma.note.count({ where: { authorId: target.id } }),
      prisma.task.count({ where: { createdById: target.id } }),
      prisma.caseStatusHistory.count({ where: { changedById: target.id } }),
    ]);
    if (cases + notes + tasks + history > 0) {
      return { error: "למשתמש יש היסטוריית פעילות ולכן אי אפשר למחוק אותו — הצע suspend_user במקום" };
    }
    return {
      params: { userId: target.id },
      summaryHebrew: `מחיקת המשתמש ${target.name} לצמיתות`,
      displayParams: [
        ["משתמש", target.name],
        ["תפקיד", USER_ROLE_LABELS[target.role] ?? target.role],
        ["סטטוס", USER_STATUS_LABELS[target.status] ?? target.status],
      ],
    };
  },
  async execute(p) {
    await adminDeleteUser(p.userId);
    return { ok: true, message: "המשתמש נמחק", entityHref: USERS_HREF };
  },
};

export const USER_ACTIONS = [approveUserAction, suspendUserAction, changeRoleAction, deleteUserAction];
