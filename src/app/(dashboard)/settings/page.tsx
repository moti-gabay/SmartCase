import { Header } from "@/components/layout/header";
import { auth } from "@/../auth";
import { getAgents } from "@/lib/queries";
import type { UserRole } from "@/types";
import { User, Mail, Shield, Users } from "lucide-react";

export const dynamic = "force-dynamic";

const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: "מנהל מערכת",
  SUPERVISOR: "מפקח",
  AGENT: "סוכן",
};

const ROLE_STYLES: Record<UserRole, string> = {
  ADMIN: "bg-violet-50 text-violet-700 border-violet-200",
  SUPERVISOR: "bg-blue-50 text-blue-700 border-blue-200",
  AGENT: "bg-slate-100 text-slate-600 border-slate-200",
};

export default async function SettingsPage() {
  const session = await auth();
  const agents = await getAgents();
  const user = session?.user;
  const role = (user?.role ?? "AGENT") as UserRole;
  const initials = (user?.name ?? "?").split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header title="הגדרות" subtitle="פרופיל אישי וניהול צוות" />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          {/* Profile */}
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-slate-900">הפרופיל שלי</h2>
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-xl font-bold text-white">
                {initials}
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2 text-sm text-slate-800">
                  <User className="h-4 w-4 text-slate-400" />
                  <span className="font-medium">{user?.name ?? "משתמש"}</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Mail className="h-4 w-4 text-slate-400" />
                  {user?.email}
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Shield className="h-4 w-4 text-slate-400" />
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${ROLE_STYLES[role]}`}>
                    {ROLE_LABELS[role]}
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* Team */}
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Users className="h-4 w-4 text-slate-400" />
              צוות ({agents.length})
            </h2>
            <div className="flex flex-col divide-y divide-slate-100">
              {agents.map((a) => {
                const ai = a.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
                return (
                  <div key={a.id} className="flex items-center gap-3 py-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-600">
                      {ai}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">{a.name}</p>
                      <p className="truncate text-xs text-slate-400">{a.email}</p>
                    </div>
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${ROLE_STYLES[a.role]}`}>
                      {ROLE_LABELS[a.role]}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          <p className="text-center text-xs text-slate-300">
            SmartCase · מערכת ניהול תיקי נכות וביטוח לאומי
          </p>
        </div>
      </main>
    </div>
  );
}
