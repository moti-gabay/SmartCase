"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { createCase } from "@/lib/actions";
import { cn } from "@/lib/utils";
import {
  CASE_TYPE_LABELS,
  PRIORITY_LABELS,
  GENDER_LABELS,
  EMPLOYMENT_STATUS_LABELS,
} from "@/lib/constants";
import type { ClientOption } from "@/lib/queries";
import type {
  UserSummary, CaseType, Priority, Gender, EmploymentStatus,
} from "@/types";
import { UserPlus, Search, FolderPlus, ArrowRight } from "lucide-react";

const field =
  "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100";
const labelCls = "mb-1 block text-xs font-medium text-slate-600";

export function NewCaseForm({
  clients,
  agents,
  initialClientId,
}: {
  clients: ClientOption[];
  agents: UserSummary[];
  initialClientId?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const preselected = initialClientId && clients.some((c) => c.id === initialClientId)
    ? initialClientId
    : undefined;
  const [clientMode, setClientMode] = useState<"existing" | "new">(
    clients.length > 0 ? "existing" : "new"
  );

  const [existingClientId, setExistingClientId] = useState(preselected ?? clients[0]?.id ?? "");
  const [newClient, setNewClient] = useState({
    fullName: "", nationalId: "", dateOfBirth: "", gender: "MALE" as Gender,
    phone: "", email: "", addressCity: "",
    employmentStatus: "UNEMPLOYED" as EmploymentStatus, primaryCondition: "",
  });
  const [caseFields, setCaseFields] = useState({
    caseType: "DISABILITY_PENSION" as CaseType,
    priority: "MEDIUM" as Priority,
    claimedPercentage: "",
    claimDescription: "",
    submissionDeadline: "",
    assignedAgentId: "",
  });

  const submit = () => {
    setError(null);
    if (clientMode === "existing" && !existingClientId) return setError("יש לבחור לקוח קיים");
    if (clientMode === "new") {
      if (newClient.fullName.trim().length < 2) return setError("יש להזין שם לקוח");
      if (newClient.nationalId.trim().length < 5) return setError("יש להזין תעודת זהות תקינה");
      if (!newClient.dateOfBirth) return setError("יש להזין תאריך לידה");
      if (newClient.phone.trim().length < 3) return setError("יש להזין מספר טלפון");
    }

    startTransition(async () => {
      try {
        const { id } = await createCase({
          clientMode,
          existingClientId: clientMode === "existing" ? existingClientId : undefined,
          newClient: clientMode === "new" ? {
            fullName: newClient.fullName.trim(),
            nationalId: newClient.nationalId.trim(),
            dateOfBirth: newClient.dateOfBirth,
            gender: newClient.gender,
            phone: newClient.phone.trim(),
            email: newClient.email.trim() || undefined,
            addressCity: newClient.addressCity.trim() || undefined,
            employmentStatus: newClient.employmentStatus,
            primaryCondition: newClient.primaryCondition.trim() || undefined,
          } : undefined,
          caseType: caseFields.caseType,
          priority: caseFields.priority,
          claimedPercentage: caseFields.claimedPercentage ? Number(caseFields.claimedPercentage) : undefined,
          claimDescription: caseFields.claimDescription.trim() || undefined,
          submissionDeadline: caseFields.submissionDeadline || undefined,
          assignedAgentId: caseFields.assignedAgentId || undefined,
        });
        router.push(`/cases/${id}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "יצירת התיק נכשלה");
      }
    });
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header title="תיק חדש" subtitle="יצירת תיק חדש ושיוכו ללקוח" />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-6">
          {/* ── Client section ── */}
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-slate-900">לקוח</h2>

            <div className="mb-4 flex gap-2">
              <button
                type="button"
                onClick={() => setClientMode("existing")}
                disabled={clients.length === 0}
                className={cn(
                  "flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-all disabled:opacity-40",
                  clientMode === "existing"
                    ? "border-indigo-600 bg-indigo-50 text-indigo-700"
                    : "border-slate-200 text-slate-600 hover:border-indigo-300"
                )}
              >
                <Search className="h-4 w-4" /> לקוח קיים
              </button>
              <button
                type="button"
                onClick={() => setClientMode("new")}
                className={cn(
                  "flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-all",
                  clientMode === "new"
                    ? "border-indigo-600 bg-indigo-50 text-indigo-700"
                    : "border-slate-200 text-slate-600 hover:border-indigo-300"
                )}
              >
                <UserPlus className="h-4 w-4" /> לקוח חדש
              </button>
            </div>

            {clientMode === "existing" ? (
              <div>
                <label className={labelCls}>בחר לקוח</label>
                <select className={field} value={existingClientId} onChange={(e) => setExistingClientId(e.target.value)}>
                  {clients.length === 0 && <option value="">אין לקוחות רשומים</option>}
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.fullName} — {c.nationalId}</option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>שם מלא *</label>
                  <input className={field} value={newClient.fullName} onChange={(e) => setNewClient({ ...newClient, fullName: e.target.value })} />
                </div>
                <div>
                  <label className={labelCls}>תעודת זהות *</label>
                  <input className={field} value={newClient.nationalId} onChange={(e) => setNewClient({ ...newClient, nationalId: e.target.value })} />
                </div>
                <div>
                  <label className={labelCls}>תאריך לידה *</label>
                  <input type="date" className={field} value={newClient.dateOfBirth} onChange={(e) => setNewClient({ ...newClient, dateOfBirth: e.target.value })} />
                </div>
                <div>
                  <label className={labelCls}>מין</label>
                  <select className={field} value={newClient.gender} onChange={(e) => setNewClient({ ...newClient, gender: e.target.value as Gender })}>
                    {(["MALE", "FEMALE", "OTHER"] as Gender[]).map((g) => <option key={g} value={g}>{GENDER_LABELS[g]}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>טלפון *</label>
                  <input className={field} value={newClient.phone} onChange={(e) => setNewClient({ ...newClient, phone: e.target.value })} />
                </div>
                <div>
                  <label className={labelCls}>אימייל</label>
                  <input type="email" className={field} value={newClient.email} onChange={(e) => setNewClient({ ...newClient, email: e.target.value })} />
                </div>
                <div>
                  <label className={labelCls}>עיר</label>
                  <input className={field} value={newClient.addressCity} onChange={(e) => setNewClient({ ...newClient, addressCity: e.target.value })} />
                </div>
                <div>
                  <label className={labelCls}>מצב תעסוקתי</label>
                  <select className={field} value={newClient.employmentStatus} onChange={(e) => setNewClient({ ...newClient, employmentStatus: e.target.value as EmploymentStatus })}>
                    {(Object.keys(EMPLOYMENT_STATUS_LABELS) as EmploymentStatus[]).map((s) => (
                      <option key={s} value={s}>{EMPLOYMENT_STATUS_LABELS[s]}</option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className={labelCls}>מצב רפואי עיקרי</label>
                  <input className={field} value={newClient.primaryCondition} onChange={(e) => setNewClient({ ...newClient, primaryCondition: e.target.value })} />
                </div>
              </div>
            )}
          </section>

          {/* ── Case section ── */}
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-slate-900">פרטי התיק</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={labelCls}>סוג תביעה *</label>
                <select className={field} value={caseFields.caseType} onChange={(e) => setCaseFields({ ...caseFields, caseType: e.target.value as CaseType })}>
                  {(Object.keys(CASE_TYPE_LABELS) as CaseType[]).map((t) => (
                    <option key={t} value={t}>{CASE_TYPE_LABELS[t]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>עדיפות</label>
                <select className={field} value={caseFields.priority} onChange={(e) => setCaseFields({ ...caseFields, priority: e.target.value as Priority })}>
                  {(["LOW", "MEDIUM", "HIGH", "URGENT"] as Priority[]).map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>אחוז נכות מבוקש</label>
                <input type="number" min={0} max={100} className={field} value={caseFields.claimedPercentage} onChange={(e) => setCaseFields({ ...caseFields, claimedPercentage: e.target.value })} />
              </div>
              <div>
                <label className={labelCls}>מועד הגשה יעד</label>
                <input type="date" className={field} value={caseFields.submissionDeadline} onChange={(e) => setCaseFields({ ...caseFields, submissionDeadline: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>שיוך לסוכן</label>
                <select className={field} value={caseFields.assignedAgentId} onChange={(e) => setCaseFields({ ...caseFields, assignedAgentId: e.target.value })}>
                  <option value="">ללא שיוך</option>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>תיאור הבקשה</label>
                <textarea
                  className="min-h-[80px] w-full rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                  value={caseFields.claimDescription}
                  onChange={(e) => setCaseFields({ ...caseFields, claimDescription: e.target.value })}
                />
              </div>
            </div>
          </section>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={() => router.back()} disabled={pending}>ביטול</Button>
            <Button onClick={submit} disabled={pending} className="gap-2">
              {pending ? "יוצר תיק..." : <><FolderPlus className="h-4 w-4" /> צור תיק</>}
              {!pending && <ArrowRight className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
