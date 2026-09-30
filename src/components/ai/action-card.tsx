"use client";

// Confirmation card for an assistant-proposed action (Human-in-the-Loop).
// Renders only what the server resolved and persisted; the buttons send the
// intent id back, never the params.
import { memo, useState } from "react";
import Link from "next/link";
import { Check, Loader2, PencilLine, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ACTION_DOMAIN_BADGES } from "@/lib/constants";
import type { IntentStatus, ProposedActionIntent } from "@/lib/ai/tools/types";

const STATUS_TEXT: Partial<Record<IntentStatus, string>> = {
  EXECUTED: "בוצע",
  FAILED: "הביצוע נכשל",
  CANCELLED: "בוטל",
  DENIED: "אין הרשאה",
  BLOCKED: "נחסם ע״י מדיניות",
  EXPIRED: "פג תוקף",
};

export const ActionCard = memo(function ActionCard({
  intent,
  onDecide,
  onRefine,
}: {
  intent: ProposedActionIntent;
  onDecide: (
    intentId: string,
    decision: "APPROVE" | "CANCEL",
    humanInput?: Record<string, string>,
    acknowledgedWarnings?: string[]
  ) => Promise<string | null>;
  onRefine: (intent: ProposedActionIntent) => void;
}) {
  const [busy, setBusy] = useState(false);
  // Destructive actions need a second click — one misclick must not delete.
  const [armed, setArmed] = useState(false);
  // Card-typed PII — held only in this component and sent with the approval;
  // never put into the chat thread or the model's context.
  const [human, setHuman] = useState<Record<string, string>>({});
  const [inputError, setInputError] = useState<string | null>(null);
  const missingRequired = (intent.humanFields ?? []).some((f) => f.required && !human[f.key]?.trim());
  // Acknowledgment is bound to the exact warning set shown: if the server
  // returns a different set (409), the checkbox resets itself.
  const warnings = intent.warnings ?? [];
  const warningKey = warnings.map((w) => w.ruleId).join("|");
  const [ackedKey, setAckedKey] = useState<string | null>(null);
  const needsAck = warnings.length > 0 && ackedKey !== warningKey;
  const badge = ACTION_DOMAIN_BADGES[intent.domain];
  const pending = intent.status === "PENDING";

  const decide = async (decision: "APPROVE" | "CANCEL") => {
    if (decision === "APPROVE" && intent.destructive && !armed) {
      setArmed(true);
      return;
    }
    setBusy(true);
    setInputError(null);
    const error = await onDecide(
      intent.intentId,
      decision,
      decision === "APPROVE" ? human : undefined,
      decision === "APPROVE" ? warnings.map((w) => w.ruleId) : undefined
    );
    setInputError(error);
    setBusy(false);
  };

  return (
    <div
      className={cn(
        "w-[85%] self-start rounded-2xl border bg-white p-3 text-sm shadow-sm",
        intent.destructive ? "border-red-200" : "border-violet-200"
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs font-medium",
            intent.destructive ? "bg-red-50 text-red-700" : "bg-violet-50 text-violet-700"
          )}
        >
          {badge ? `${badge.icon} ${badge.label}` : intent.domain}
        </span>
        {!pending && (
          <span
            className={cn(
              "text-xs font-medium",
              intent.status === "EXECUTED" ? "text-emerald-600" : "text-slate-500"
            )}
          >
            {STATUS_TEXT[intent.status]}
          </span>
        )}
      </div>

      <p className="mb-2 font-medium text-slate-900">{intent.summaryHebrew}</p>

      <dl className="mb-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        {intent.displayParams.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-slate-500">{label}</dt>
            <dd className="text-slate-800" dir="auto">
              {value}
            </dd>
          </div>
        ))}
      </dl>

      {pending && warnings.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
          <p className="mb-1 flex items-center gap-1 font-medium">
            <TriangleAlert className="h-3.5 w-3.5" />
            אזהרת מדיניות
          </p>
          <ul className="mb-2 list-disc space-y-0.5 ps-4">
            {warnings.map((w) => (
              <li key={w.ruleId}>{w.reasonHebrew}</li>
            ))}
          </ul>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={!needsAck}
              onChange={(e) => setAckedKey(e.target.checked ? warningKey : null)}
              className="h-3.5 w-3.5 accent-amber-600"
            />
            קראתי והבנתי את האזהרות
          </label>
        </div>
      )}

      {pending && intent.humanFields?.length ? (
        <div className="mb-3 space-y-2 rounded-lg bg-slate-50 p-2">
          <p className="text-xs text-slate-500">פרטים מזהים — מלא כאן (לא נשלחים לעוזר):</p>
          {intent.humanFields.map((f) => (
            <label key={f.key} className="flex items-center gap-2 text-xs">
              <span className="w-16 shrink-0 text-slate-600">
                {f.label}
                {f.required && <span className="text-red-500"> *</span>}
              </span>
              <input
                type={f.inputType}
                dir="ltr"
                autoComplete="off"
                value={human[f.key] ?? ""}
                onChange={(e) => setHuman((prev) => ({ ...prev, [f.key]: e.target.value }))}
                className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-sm focus:border-violet-400 focus:outline-none"
              />
            </label>
          ))}
        </div>
      ) : null}

      {inputError && pending && <p className="mb-2 text-xs text-red-600">{inputError}</p>}

      {intent.resultMessage && !pending && (
        <p className={cn("mb-2 text-xs", intent.status === "EXECUTED" ? "text-emerald-700" : "text-red-600")}>
          {intent.resultMessage}
          {intent.entityHref && intent.status === "EXECUTED" && (
            <>
              {" · "}
              <Link href={intent.entityHref} className="underline">
                מעבר לפריט
              </Link>
            </>
          )}
        </p>
      )}

      {pending && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => decide("APPROVE")}
            disabled={busy || missingRequired || needsAck}
            className={cn(
              "flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50",
              intent.destructive ? "bg-red-600 hover:bg-red-700" : "bg-violet-600 hover:bg-violet-700"
            )}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            {armed ? "לחץ שוב לאישור סופי" : "אישור וביצוע"}
          </button>
          <button
            onClick={() => onRefine(intent)}
            disabled={busy}
            className="flex items-center gap-1 rounded-lg bg-slate-100 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-200 disabled:opacity-50"
          >
            <PencilLine className="h-3.5 w-3.5" />
            תיקון בקול/טקסט
          </button>
          <button
            onClick={() => decide("CANCEL")}
            disabled={busy}
            className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
            ביטול
          </button>
        </div>
      )}
    </div>
  );
});
