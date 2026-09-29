"use client";

// Confirmation card for an assistant-proposed action (Human-in-the-Loop).
// Renders only what the server resolved and persisted; the buttons send the
// intent id back, never the params.
import { memo, useState } from "react";
import Link from "next/link";
import { Check, Loader2, PencilLine, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ACTION_DOMAIN_BADGES } from "@/lib/constants";
import type { IntentStatus, ProposedActionIntent } from "@/lib/ai/tools/types";

const STATUS_TEXT: Partial<Record<IntentStatus, string>> = {
  EXECUTED: "בוצע",
  FAILED: "הביצוע נכשל",
  CANCELLED: "בוטל",
  DENIED: "אין הרשאה",
  EXPIRED: "פג תוקף",
};

export const ActionCard = memo(function ActionCard({
  intent,
  onDecide,
  onRefine,
}: {
  intent: ProposedActionIntent;
  onDecide: (intentId: string, decision: "APPROVE" | "CANCEL") => Promise<boolean>;
  onRefine: (intent: ProposedActionIntent) => void;
}) {
  const [busy, setBusy] = useState(false);
  // Destructive actions need a second click — one misclick must not delete.
  const [armed, setArmed] = useState(false);
  const badge = ACTION_DOMAIN_BADGES[intent.domain];
  const pending = intent.status === "PENDING";

  const decide = async (decision: "APPROVE" | "CANCEL") => {
    if (decision === "APPROVE" && intent.destructive && !armed) {
      setArmed(true);
      return;
    }
    setBusy(true);
    await onDecide(intent.intentId, decision);
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
            disabled={busy}
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
