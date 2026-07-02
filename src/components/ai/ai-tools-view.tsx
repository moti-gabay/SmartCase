"use client";

import { useState } from "react";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import type { CaseOption } from "@/lib/queries";
import { Sparkles, FileText, Copy, Check } from "lucide-react";

export function AiToolsView({ cases }: { cases: CaseOption[] }) {
  const [caseId, setCaseId] = useState(cases[0]?.id ?? "");
  const [loading, setLoading] = useState(false);
  const [letter, setLetter] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    if (!caseId) return;
    setLoading(true);
    setError(null);
    setLetter(null);
    try {
      const res = await fetch("/api/ai/letter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId }),
      });
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      setLetter(data.letter);
    } catch {
      setError("יצירת המכתב נכשלה. ודא שמפתח ה-API של Claude מוגדר ונסה שוב.");
    } finally {
      setLoading(false);
    }
  };

  const copy = () => {
    if (!letter) return;
    navigator.clipboard.writeText(letter);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header title="כלי AI" subtitle="כלים מבוססי Claude ליצירת מכתבים וניתוח מסמכים" />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          {/* Letter generator */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-600">
                <Sparkles className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-semibold text-slate-900">מחולל מכתבים בעברית</h3>
                <p className="mt-1 text-sm text-slate-500 leading-relaxed">
                  בחר תיק ו-Claude יצור מכתב בקשה/ערעור רשמי בעברית מקצועית, מותאם לנתוני הלקוח והתביעה.
                </p>

                <div className="mt-4 flex flex-wrap items-end gap-3">
                  <div className="flex-1 min-w-[220px]">
                    <label className="mb-1 block text-xs font-medium text-slate-600">תיק</label>
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
                  <Button onClick={generate} disabled={loading || !caseId} className="gap-2">
                    {loading
                      ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> מייצר...</>
                      : <><Sparkles className="h-4 w-4" /> צור מכתב</>}
                  </Button>
                </div>

                {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
              </div>
            </div>

            {letter && (
              <div className="mt-5 rounded-xl border border-violet-200 bg-violet-50 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-violet-700">טיוטת מכתב</span>
                  <button onClick={copy} className="flex items-center gap-1 text-xs text-violet-600 hover:underline">
                    {copied ? <><Check className="h-3.5 w-3.5" /> הועתק</> : <><Copy className="h-3.5 w-3.5" /> העתק</>}
                  </button>
                </div>
                <pre className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700 font-sans" dir="rtl">
                  {letter}
                </pre>
              </div>
            )}
          </div>

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
                  ניתוח מסמך מתבצע מתוך עמוד התיק, בטאב <span className="font-semibold text-slate-600">מסמכים</span>,
                  ליד כל מסמך שהועלה.
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
