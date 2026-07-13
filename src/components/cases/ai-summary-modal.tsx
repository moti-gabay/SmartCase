"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { generateAiSummary, commitAiSummary } from "@/lib/actions";
import { Sparkles, Loader2, X, Lock, AlertTriangle } from "lucide-react";

interface AiSummaryModalProps {
  caseId: string;
  open: boolean;
  onClose: () => void;
}

export function AiSummaryModal({ caseId, open, onClose }: AiSummaryModalProps) {
  const router = useRouter();
  const [rawInput, setRawInput] = useState("");
  const [summary, setSummary] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCommitting, startCommit] = useTransition();

  if (!open) return null;

  const reset = () => {
    setRawInput("");
    setSummary("");
    setError(null);
    setIsGenerating(false);
  };

  const close = () => {
    if (isGenerating || isCommitting) return;
    reset();
    onClose();
  };

  const handleGenerate = async () => {
    setError(null);
    setIsGenerating(true);
    try {
      const res = await generateAiSummary(caseId, rawInput);
      setSummary(res.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "יצירת הסיכום נכשלה");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCommit = () => {
    setError(null);
    startCommit(async () => {
      try {
        await commitAiSummary(caseId, summary);
        reset();
        onClose();
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "שמירת הסיכום נכשלה");
      }
    });
  };

  const canGenerate = rawInput.trim().length >= 10 && !isGenerating;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={close}>
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 p-5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-600">
              <Sparkles className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-slate-900">סיכום שיחה חכם</h2>
              <p className="text-xs text-slate-500">הדבק רישום גולמי של השיחה — ה-AI יבנה סיכום מובנה לתיעוד</p>
            </div>
          </div>
          <button onClick={close} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100" aria-label="סגור">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-col gap-4 overflow-y-auto p-5">
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
              <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
            </div>
          )}

          {/* Raw input */}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">רישום גולמי של השיחה</label>
            <textarea
              value={rawInput}
              onChange={(e) => setRawInput(e.target.value)}
              rows={5}
              dir="rtl"
              placeholder="לדוגמה: שוחחתי עם הלקוח לגבי סטטוס התביעה. סוכם שיביא אישור רפואי עד סוף החודש. הלקוח ביקש לבדוק אפשרות לערעור..."
              className="w-full resize-none rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100 transition-all"
            />
            <div className="mt-2 flex justify-end">
              <Button size="sm" className="gap-1.5" disabled={!canGenerate} onClick={handleGenerate}>
                {isGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {isGenerating ? "מנסח סיכום..." : summary ? "נסח מחדש" : "נסח עם AI"}
              </Button>
            </div>
          </div>

          {/* Preview (editable) */}
          {summary && (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                תצוגה מקדימה של הסיכום <span className="text-slate-400">· ניתן לערוך לפני אישור</span>
              </label>
              <textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                rows={10}
                dir="rtl"
                className="w-full resize-none rounded-lg border border-amber-200 bg-amber-50/40 p-3 text-sm leading-relaxed text-slate-800 focus:border-amber-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-100 transition-all"
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 p-5">
          <Button variant="outline" size="sm" onClick={close} disabled={isCommitting}>ביטול</Button>
          <Button
            size="sm"
            className="gap-1.5"
            disabled={!summary.trim() || isGenerating || isCommitting}
            onClick={handleCommit}
          >
            {isCommitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lock className="h-3.5 w-3.5" />}
            אשר ונעל לציר הזמן
          </Button>
        </div>
      </div>
    </div>
  );
}
