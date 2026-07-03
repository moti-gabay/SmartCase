"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { LETTER_TYPE_LABELS } from "@/lib/constants";
import { cn, formatDatetime } from "@/lib/utils";
import type { GeneratedLetterItem, LetterType } from "@/types";
import { Sparkles, Copy, Check, Trash2, FileText, Loader2, Send, MessageSquare } from "lucide-react";

type ChatMsg = { role: "user" | "assistant"; text: string };

export function LetterGenerator({ caseId, clientName }: { caseId?: string; clientName?: string }) {
  const [letterType, setLetterType] = useState<LetterType>("CLAIM_REQUEST");
  const [context, setContext] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<GeneratedLetterItem | null>(null);
  const [letters, setLetters] = useState<GeneratedLetterItem[]>([]);
  const [copied, setCopied] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [refining, setRefining] = useState(false);

  // Reset the refinement chat whenever the displayed letter changes.
  useEffect(() => { setChat([]); setChatInput(""); }, [current?.id]);

  const loadLetters = useCallback(async () => {
    if (!caseId) { setLetters([]); return; }
    try {
      const res = await fetch(`/api/ai/letter?caseId=${caseId}`);
      if (res.ok) setLetters((await res.json()).letters ?? []);
    } catch { /* ignore */ }
  }, [caseId]);

  useEffect(() => {
    setCurrent(null);
    loadLetters();
  }, [loadLetters]);

  const generate = async () => {
    if (!caseId) return;
    setLoading(true);
    setError(null);
    setCurrent(null);
    try {
      const res = await fetch("/api/ai/letter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId, letterType, context }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "יצירת המכתב נכשלה");
      }
      const letter: GeneratedLetterItem = await res.json();
      setCurrent(letter);
      setLetters((prev) => [letter, ...prev]);
      setContext("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "יצירת המכתב נכשלה. ודא שמפתח ה-API מוגדר.");
    } finally {
      setLoading(false);
    }
  };

  const sendFeedback = async () => {
    const fb = chatInput.trim();
    if (!current || !fb || refining) return;
    setChat((prev) => [...prev, { role: "user", text: fb }]);
    setChatInput("");
    setRefining(true);
    try {
      const res = await fetch(`/api/ai/letter/${current.id}/refine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback: fb }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      const updated = { ...current, content: data.content };
      setCurrent(updated);
      setLetters((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
      setChat((prev) => [...prev, { role: "assistant", text: "עודכן המכתב לפי בקשתך ✓" }]);
    } catch {
      setChat((prev) => [...prev, { role: "assistant", text: "העדכון נכשל, נסה שוב." }]);
    } finally {
      setRefining(false);
    }
  };

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const remove = async (id: string) => {
    setDeletingId(id);
    try {
      await fetch(`/api/ai/letter/${id}`, { method: "DELETE" });
      setLetters((prev) => prev.filter((l) => l.id !== id));
      if (current?.id === id) setCurrent(null);
    } catch { /* ignore */ } finally {
      setDeletingId(null);
    }
  };

  const inputCls =
    "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-600">
          <Sparkles className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h3 className="text-base font-semibold text-slate-900">מחולל מכתבים בעברית</h3>
          <p className="mt-1 text-sm text-slate-500 leading-relaxed">
            בחר סוג מכתב, הוסף פרטים על המקרה, ו-Claude יצור מכתב רשמי ומקצועי{clientName ? ` עבור ${clientName}` : ""}. המכתב נשמר אוטומטית בתיק.
          </p>
        </div>
      </div>

      {!caseId ? (
        <p className="mt-4 rounded-lg border border-dashed border-slate-200 py-6 text-center text-sm text-slate-400">
          בחר תיק כדי ליצור מכתב
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">סוג מכתב</label>
            <select className={inputCls} value={letterType} onChange={(e) => setLetterType(e.target.value as LetterType)}>
              {(Object.keys(LETTER_TYPE_LABELS) as LetterType[]).map((t) => (
                <option key={t} value={t}>{LETTER_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              פרטים על המקרה, נסיבות ונימוקים <span className="text-slate-400">(אופציונלי)</span>
            </label>
            <textarea
              className="min-h-[90px] w-full rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              placeholder="לדוגמה: המצב הרפואי הוחמר בחצי השנה האחרונה, נוספו כאבים ותרופות חדשות, הלקוח אינו מסוגל לעבוד..."
              value={context}
              onChange={(e) => setContext(e.target.value)}
            />
          </div>
          <div>
            <Button onClick={generate} disabled={loading} className="gap-2">
              {loading
                ? <><Loader2 className="h-4 w-4 animate-spin" /> מייצר מכתב...</>
                : <><Sparkles className="h-4 w-4" /> צור מכתב</>}
            </Button>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      )}

      {/* Current draft */}
      {current && (
        <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50 p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-violet-700">{current.title}</span>
            <button onClick={() => copy(current.content)} className="flex items-center gap-1 text-xs text-violet-600 hover:underline">
              {copied ? <><Check className="h-3.5 w-3.5" /> הועתק</> : <><Copy className="h-3.5 w-3.5" /> העתק</>}
            </button>
          </div>
          <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-slate-700 font-sans" dir="rtl">
            {current.content}
          </pre>

          {/* Refinement chat */}
          <div className="mt-3 border-t border-violet-200 pt-3">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-violet-700">
              <MessageSquare className="h-3.5 w-3.5" />
              שיפור המכתב — שלח הערות ו-Claude יעדכן
            </p>

            {chat.length > 0 && (
              <div className="mb-2 flex max-h-44 flex-col gap-1.5 overflow-y-auto">
                {chat.map((m, i) => (
                  <div
                    key={i}
                    className={cn(
                      "max-w-[85%] rounded-lg px-3 py-1.5 text-xs leading-relaxed",
                      m.role === "user"
                        ? "self-end bg-indigo-600 text-white"
                        : "self-start border border-slate-200 bg-white text-slate-600"
                    )}
                  >
                    {m.text}
                  </div>
                ))}
                {refining && (
                  <div className="self-start flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-500">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> מעדכן את המכתב...
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendFeedback(); } }}
                disabled={refining}
                placeholder="לדוגמה: הפוך את הנימה לתקיפה יותר, קצר את המכתב, הוסף אזכור לסעיף 208..."
                className="h-9 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
              <Button size="sm" onClick={sendFeedback} disabled={refining || !chatInput.trim()} className="gap-1.5">
                {refining ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                שלח
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Saved letters */}
      {letters.length > 0 && (
        <div className="mt-5">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400">מכתבים שמורים ({letters.length})</h4>
          <div className="flex flex-col divide-y divide-slate-100">
            {letters.map((l) => (
              <div key={l.id} className="flex items-center gap-3 py-2.5">
                <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                <button onClick={() => setCurrent(l)} className="min-w-0 flex-1 text-start">
                  <p className="truncate text-sm text-slate-800 hover:text-indigo-600">{LETTER_TYPE_LABELS[l.letterType]}</p>
                  <p className="text-[11px] text-slate-400">{formatDatetime(l.createdAt)}{l.createdByName ? ` · ${l.createdByName}` : ""}</p>
                </button>
                <button onClick={() => copy(l.content)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-indigo-600" aria-label="העתק">
                  <Copy className="h-4 w-4" />
                </button>
                <button onClick={() => remove(l.id)} disabled={deletingId === l.id} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="מחק">
                  {deletingId === l.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
