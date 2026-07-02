"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { updateCase } from "@/lib/actions";
import { CASE_TYPE_LABELS, PRIORITY_LABELS } from "@/lib/constants";
import type { CaseDetail, UserSummary, CaseType, Priority } from "@/types";
import { ChevronLeft, Save } from "lucide-react";

const field =
  "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100";
const labelCls = "mb-1 block text-xs font-medium text-slate-600";
const toDateInput = (iso?: string | null) => (iso ? iso.slice(0, 10) : "");

export function CaseEditForm({ caseDetail, agents }: { caseDetail: CaseDetail; agents: UserSummary[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [f, setF] = useState({
    caseType: caseDetail.caseType as CaseType,
    priority: caseDetail.priority as Priority,
    claimedPercentage: caseDetail.claimedPercentage != null ? String(caseDetail.claimedPercentage) : "",
    claimDescription: caseDetail.claimDescription ?? "",
    authorityReferenceNumber: caseDetail.authorityReferenceNumber ?? "",
    submissionDeadline: toDateInput(caseDetail.submissionDeadline),
    nextFollowUpDate: toDateInput(caseDetail.nextFollowUpDate),
    assignedAgentId: caseDetail.assignedAgent?.id ?? "",
  });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  const submit = () => {
    setError(null);
    startTransition(async () => {
      try {
        await updateCase(caseDetail.id, {
          caseType: f.caseType,
          priority: f.priority,
          claimedPercentage: f.claimedPercentage ? Number(f.claimedPercentage) : undefined,
          claimDescription: f.claimDescription.trim() || undefined,
          authorityReferenceNumber: f.authorityReferenceNumber.trim() || undefined,
          submissionDeadline: f.submissionDeadline || undefined,
          nextFollowUpDate: f.nextFollowUpDate || undefined,
          assignedAgentId: f.assignedAgentId || undefined,
        });
        router.push(`/cases/${caseDetail.id}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "שמירת התיק נכשלה");
      }
    });
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header title="עריכת תיק" subtitle={`${caseDetail.caseNumber} · ${caseDetail.client.fullName}`} />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-5">
          <Link href={`/cases/${caseDetail.id}`} className="flex items-center gap-1 text-xs text-slate-500 hover:text-indigo-600">
            <ChevronLeft className="h-3.5 w-3.5 rtl:rotate-180" />
            חזרה לתיק
          </Link>

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-slate-900">פרטי התיק</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={labelCls}>סוג תביעה</label>
                <select className={field} value={f.caseType} onChange={(e) => set("caseType", e.target.value)}>
                  {(Object.keys(CASE_TYPE_LABELS) as CaseType[]).map((t) => <option key={t} value={t}>{CASE_TYPE_LABELS[t]}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>עדיפות</label>
                <select className={field} value={f.priority} onChange={(e) => set("priority", e.target.value)}>
                  {(["LOW", "MEDIUM", "HIGH", "URGENT"] as Priority[]).map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
                </select>
              </div>
              <div><label className={labelCls}>אחוז נכות מבוקש</label><input type="number" min={0} max={100} className={field} value={f.claimedPercentage} onChange={(e) => set("claimedPercentage", e.target.value)} /></div>
              <div><label className={labelCls}>מס׳ אסמכתא ביטוח לאומי</label><input className={field} value={f.authorityReferenceNumber} onChange={(e) => set("authorityReferenceNumber", e.target.value)} /></div>
              <div><label className={labelCls}>מועד הגשה</label><input type="date" className={field} value={f.submissionDeadline} onChange={(e) => set("submissionDeadline", e.target.value)} /></div>
              <div><label className={labelCls}>מעקב הבא</label><input type="date" className={field} value={f.nextFollowUpDate} onChange={(e) => set("nextFollowUpDate", e.target.value)} /></div>
              <div className="sm:col-span-2">
                <label className={labelCls}>שיוך לסוכן</label>
                <select className={field} value={f.assignedAgentId} onChange={(e) => set("assignedAgentId", e.target.value)}>
                  <option value="">ללא שיוך</option>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>תיאור הבקשה</label>
                <textarea className="min-h-[90px] w-full rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" value={f.claimDescription} onChange={(e) => set("claimDescription", e.target.value)} />
              </div>
            </div>
          </section>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={() => router.push(`/cases/${caseDetail.id}`)} disabled={pending}>ביטול</Button>
            <Button onClick={submit} disabled={pending} className="gap-2">
              {pending ? "שומר..." : <><Save className="h-4 w-4" /> שמור שינויים</>}
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
