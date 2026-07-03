"use client";

import { useState } from "react";
import { Header } from "@/components/layout/header";
import { LetterGenerator } from "@/components/ai/letter-generator";
import type { CaseOption } from "@/lib/queries";
import { FileText } from "lucide-react";

export function AiToolsView({ cases }: { cases: CaseOption[] }) {
  const [caseId, setCaseId] = useState(cases[0]?.id ?? "");
  const selected = cases.find((c) => c.id === caseId);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header title="כלי AI" subtitle="כלים מבוססי Claude ליצירת מכתבים וניתוח מסמכים" />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          {/* Case picker */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <label className="mb-1 block text-xs font-medium text-slate-600">בחר תיק</label>
            <select
              value={caseId}
              onChange={(e) => setCaseId(e.target.value)}
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            >
              {cases.length === 0 && <option value="">אין תיקים זמינים</option>}
              {cases.map((c) => (
                <option key={c.id} value={c.id}>{c.caseNumber} – {c.clientName}</option>
              ))}
            </select>
          </div>

          {/* Letter generator */}
          <LetterGenerator caseId={caseId || undefined} clientName={selected?.clientName} />

          {/* Document analyzer info */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-600">
                <FileText className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-900">מנתח מסמכים</h3>
                <p className="mt-1 text-sm text-slate-500 leading-relaxed">
                  Claude מאמת מסמכים מועלים – בודק תוקף, חתימות, תאריכים ותקינות מול דרישות ביטוח לאומי.
                </p>
                <p className="mt-2 text-xs text-slate-400">
                  ניתוח מסמך מתבצע מתוך עמוד התיק, בטאב <span className="font-semibold text-slate-600">מסמכים</span>.
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
