"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { adminUpdateUser, approveUser, suspendUser, adminDeleteUser } from "@/lib/actions";
import {
  USER_ROLE_LABELS,
  USER_STATUS_LABELS,
  USER_STATUS_COLORS,
  USER_STATUS_DOT,
} from "@/lib/constants";
import type { AdminUserRow, UserRole } from "@/types";
import { Users, UserCheck, Clock, Ban, CheckCircle2, AlertCircle, Trash2 } from "lucide-react";

const STAFF_ROLES: UserRole[] = ["ADMIN", "SUPERVISOR", "AGENT"];

function StatsBar({ users }: { users: AdminUserRow[] }) {
  const stats = [
    { label: "סך המשתמשים", value: users.length, icon: Users, iconBg: "bg-indigo-50", iconColor: "text-indigo-600" },
    { label: "ממתינים לאישור", value: users.filter((u) => u.status === "PENDING_APPROVAL").length, icon: Clock, iconBg: "bg-amber-50", iconColor: "text-amber-600", highlight: true },
    { label: "מאושרים", value: users.filter((u) => u.status === "APPROVED").length, icon: UserCheck, iconBg: "bg-emerald-50", iconColor: "text-emerald-600" },
    { label: "מושעים", value: users.filter((u) => u.status === "SUSPENDED").length, icon: Ban, iconBg: "bg-red-50", iconColor: "text-red-600" },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {stats.map(({ label, value, icon: Icon, iconBg, iconColor, highlight }) => (
        <div
          key={label}
          className={`flex items-center gap-3 rounded-xl border bg-white p-4 shadow-sm ${
            highlight && value > 0 ? "border-amber-200" : "border-slate-200"
          }`}
        >
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${iconBg}`}>
            <Icon className={`h-5 w-5 ${iconColor}`} />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-900 leading-tight">{value}</p>
            <p className="text-xs text-slate-500">{label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: AdminUserRow["status"] }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${USER_STATUS_COLORS[status]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${USER_STATUS_DOT[status]}`} />
      {USER_STATUS_LABELS[status]}
    </span>
  );
}

interface UsersViewProps {
  users: AdminUserRow[];
}

export function UsersView({ users }: UsersViewProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const currentUserId = session?.user?.id;

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [suspendTarget, setSuspendTarget] = useState<AdminUserRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUserRow | null>(null);

  function run(id: string, fn: () => Promise<void>) {
    setError(null);
    setBusyId(id);
    startTransition(async () => {
      try {
        await fn();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "אירעה שגיאה");
      } finally {
        setBusyId(null);
      }
    });
  }

  const dateFmt = (iso: string) => new Date(iso).toLocaleDateString("he-IL");

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header title="ניהול משתמשים" subtitle={`${users.length} משתמשים במערכת`} />

      <main className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-5 p-6">
          <StatsBar users={users} />

          {error && (
            <div className="flex items-start gap-2.5 rounded-lg bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500">
                    <th className="px-4 py-3 font-semibold">משתמש</th>
                    <th className="px-4 py-3 font-semibold">תפקיד</th>
                    <th className="px-4 py-3 font-semibold">סטטוס</th>
                    <th className="px-4 py-3 font-semibold">תיקים משויכים</th>
                    <th className="px-4 py-3 font-semibold">נוצר</th>
                    <th className="px-4 py-3 font-semibold">פעולות</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                        לא נמצאו משתמשים
                      </td>
                    </tr>
                  )}
                  {users.map((u) => {
                    const isSelf = u.id === currentUserId;
                    const rowBusy = busyId === u.id && isPending;
                    return (
                      <tr key={u.id} className="hover:bg-slate-50/70">
                        {/* User */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700">
                              {u.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?"}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate font-medium text-slate-900">
                                {u.name}
                                {isSelf && <span className="ms-2 text-[10px] font-normal text-indigo-400">(אתה)</span>}
                              </p>
                              <p className="truncate text-xs text-slate-500" dir="ltr">{u.email}</p>
                            </div>
                          </div>
                        </td>

                        {/* Role */}
                        <td className="px-4 py-3">
                          <select
                            value={u.role}
                            disabled={isSelf || rowBusy}
                            onChange={(e) => run(u.id, () => adminUpdateUser(u.id, { role: e.target.value as UserRole }))}
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                          >
                            {STAFF_ROLES.map((r) => (
                              <option key={r} value={r}>{USER_ROLE_LABELS[r]}</option>
                            ))}
                          </select>
                        </td>

                        {/* Status */}
                        <td className="px-4 py-3"><StatusBadge status={u.status} /></td>

                        {/* Assigned cases */}
                        <td className="px-4 py-3 text-slate-600">{u.assignedCasesCount}</td>

                        {/* Created */}
                        <td className="px-4 py-3 text-slate-500">{dateFmt(u.createdAt)}</td>

                        {/* Actions */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {u.status !== "APPROVED" && (
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={rowBusy}
                                onClick={() => run(u.id, () => approveUser(u.id))}
                                className="gap-1.5"
                              >
                                <CheckCircle2 className="h-4 w-4" />
                                אשר
                              </Button>
                            )}
                            {u.status !== "SUSPENDED" && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={isSelf || rowBusy}
                                onClick={() => setSuspendTarget(u)}
                                className="gap-1.5 text-red-600 hover:bg-red-50"
                              >
                                <Ban className="h-4 w-4" />
                                השעה
                              </Button>
                            )}
                            {!isSelf && (
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={rowBusy}
                                onClick={() => setDeleteTarget(u)}
                                title="מחיקת משתמש"
                                className="gap-1.5 text-red-600 hover:bg-red-50"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>

      <ConfirmDialog
        open={!!suspendTarget}
        danger
        title="השעיית משתמש"
        message={
          <>
            להשעות את <strong>{suspendTarget?.name}</strong>? המשתמש ינותק ולא יוכל להתחבר מחדש עד להסרת ההשעיה.
          </>
        }
        confirmLabel="השעה"
        pending={isPending}
        onCancel={() => setSuspendTarget(null)}
        onConfirm={() => {
          const t = suspendTarget;
          setSuspendTarget(null);
          if (t) run(t.id, () => suspendUser(t.id));
        }}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        danger
        title="מחיקת משתמש"
        message={
          <>
            למחוק לצמיתות את <strong>{deleteTarget?.name}</strong>? פעולה זו בלתי הפיכה. ניתן למחוק
            רק חשבונות ללא היסטוריית פעילות — למשתמש פעיל יש להשתמש בהשעיה.
          </>
        }
        confirmLabel="מחק"
        pending={isPending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          const t = deleteTarget;
          setDeleteTarget(null);
          if (t) run(t.id, () => adminDeleteUser(t.id));
        }}
      />
    </div>
  );
}
