import { cn, timeAgo, formatDate } from "@/lib/utils";
import type { NoteDetail, StatusHistoryEntry, NoteType, CaseActivityEntry, ActivityType } from "@/types";
import { CASE_STATUS_LABELS, CASE_STATUS_DOT, NOTE_TYPE_LABELS } from "@/lib/constants";
import {
  Phone, Mail, Users, Building2, StickyNote, Cpu, ArrowRight, Lock,
  FilePlus2, Upload, CheckCircle2, XCircle, Milestone, Sparkles,
} from "lucide-react";

// ─── Note type icons ──────────────────────────────────────────────────────────

const NOTE_ICONS: Record<NoteType, React.ElementType> = {
  INTERNAL:          StickyNote,
  CALL_LOG:          Phone,
  EMAIL:             Mail,
  MEETING:           Users,
  AUTHORITY_CONTACT: Building2,
  SYSTEM:            Cpu,
};

const NOTE_COLORS: Record<NoteType, string> = {
  INTERNAL:          "bg-yellow-50 border-yellow-200 text-yellow-700",
  CALL_LOG:          "bg-blue-50 border-blue-200 text-blue-700",
  EMAIL:             "bg-violet-50 border-violet-200 text-violet-700",
  MEETING:           "bg-emerald-50 border-emerald-200 text-emerald-700",
  AUTHORITY_CONTACT: "bg-orange-50 border-orange-200 text-orange-700",
  SYSTEM:            "bg-slate-50 border-slate-200 text-slate-500",
};

const NOTE_ICON_BG: Record<NoteType, string> = {
  INTERNAL:          "bg-yellow-100 text-yellow-600",
  CALL_LOG:          "bg-blue-100 text-blue-600",
  EMAIL:             "bg-violet-100 text-violet-600",
  MEETING:           "bg-emerald-100 text-emerald-600",
  AUTHORITY_CONTACT: "bg-orange-100 text-orange-600",
  SYSTEM:            "bg-slate-100 text-slate-500",
};

// ─── Activity type icons / colors (Smart Activity Timeline) ───────────────────

const ACTIVITY_ICONS: Record<ActivityType, React.ElementType> = {
  CASE_CREATED:      FilePlus2,
  DOCUMENT_UPLOADED: Upload,
  DOCUMENT_APPROVED: CheckCircle2,
  DOCUMENT_REJECTED: XCircle,
  STEP_CHANGED:      Milestone,
  AI_CALL_SUMMARY:   Sparkles,
};

const ACTIVITY_ICON_BG: Record<ActivityType, string> = {
  CASE_CREATED:      "bg-indigo-100 text-indigo-600",
  DOCUMENT_UPLOADED: "bg-blue-100 text-blue-600",
  DOCUMENT_APPROVED: "bg-emerald-100 text-emerald-600",
  DOCUMENT_REJECTED: "bg-red-100 text-red-600",
  STEP_CHANGED:      "bg-violet-100 text-violet-600",
  AI_CALL_SUMMARY:   "bg-amber-100 text-amber-600",
};

// ─── Combined timeline entry type ─────────────────────────────────────────────

type TimelineEntry =
  | { kind: "note"; data: NoteDetail; date: string }
  | { kind: "status"; data: StatusHistoryEntry; date: string }
  | { kind: "activity"; data: CaseActivityEntry; date: string };

// ─── Note card ────────────────────────────────────────────────────────────────

function NoteCard({ note }: { note: NoteDetail }) {
  const Icon = NOTE_ICONS[note.type];
  return (
    <div className={cn("rounded-xl border p-4", NOTE_COLORS[note.type])}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className={cn("flex h-7 w-7 items-center justify-center rounded-lg text-xs", NOTE_ICON_BG[note.type])}>
            <Icon className="h-3.5 w-3.5" />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold">{NOTE_TYPE_LABELS[note.type]}</span>
              {note.isPrivate && (
                <span className="flex items-center gap-1 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                  <Lock className="h-2.5 w-2.5" /> פרטי
                </span>
              )}
            </div>
            <p className="text-[11px] opacity-70">
              {note.authorName} · {timeAgo(note.createdAt)}
            </p>
          </div>
        </div>
        {note.followUpDate && (
          <span className="shrink-0 rounded-md bg-white/60 px-2 py-1 text-[11px] font-medium">
            מעקב: {formatDate(note.followUpDate)}
          </span>
        )}
      </div>
      <p className="mt-3 text-sm leading-relaxed opacity-90">{note.content}</p>
    </div>
  );
}

// ─── Status change card ────────────────────────────────────────────────────────

function StatusChangeCard({ entry }: { entry: StatusHistoryEntry }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
        <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-500">שינוי סטטוס:</span>
          {entry.previousStatus && (
            <>
              <span className="flex items-center gap-1">
                <span className={cn("h-2 w-2 rounded-full", CASE_STATUS_DOT[entry.previousStatus])} />
                <span className="text-slate-600">{CASE_STATUS_LABELS[entry.previousStatus]}</span>
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-slate-400 rtl:rotate-180" />
            </>
          )}
          <span className="flex items-center gap-1 font-semibold">
            <span className={cn("h-2 w-2 rounded-full", CASE_STATUS_DOT[entry.newStatus])} />
            <span className="text-slate-800">{CASE_STATUS_LABELS[entry.newStatus]}</span>
          </span>
        </div>
        {entry.reason && <p className="text-xs text-slate-500 mt-0.5">{entry.reason}</p>}
      </div>
      <div className="text-right shrink-0">
        <p className="text-[11px] text-slate-500">{entry.changedByName}</p>
        <p className="text-[11px] text-slate-400">{timeAgo(entry.createdAt)}</p>
      </div>
    </div>
  );
}

// ─── System activity card (Smart Activity Timeline) ───────────────────────────

function ActivityCard({ activity }: { activity: CaseActivityEntry }) {
  const Icon = ACTIVITY_ICONS[activity.type];
  return (
    <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
      <span className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", ACTIVITY_ICON_BG[activity.type])}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <p className="flex-1 min-w-0 whitespace-pre-line text-sm leading-relaxed text-slate-700">{activity.description}</p>
      <div className="shrink-0 text-left">
        {activity.userName && <p className="text-[11px] text-slate-500">{activity.userName}</p>}
        <p className="text-[11px] text-slate-400">{timeAgo(activity.createdAt)}</p>
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

interface ActivityTimelineProps {
  notes: NoteDetail[];
  statusHistory: StatusHistoryEntry[];
  activities?: CaseActivityEntry[];
}

export function ActivityTimeline({ notes, statusHistory, activities = [] }: ActivityTimelineProps) {
  const entries: TimelineEntry[] = [
    ...notes.map((n) => ({ kind: "note" as const, data: n, date: n.createdAt })),
    ...statusHistory.map((s) => ({ kind: "status" as const, data: s, date: s.createdAt })),
    ...activities.map((a) => ({ kind: "activity" as const, data: a, date: a.createdAt })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <div className="flex flex-col gap-3">
      {/* Add note CTA */}
      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <textarea
          rows={2}
          placeholder="הוסף הערה פנימית, יומן שיחה, הודעה..."
          className="w-full resize-none rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100 transition-all"
          dir="rtl"
        />
        <div className="mt-2 flex items-center justify-between">
          <div className="flex gap-1.5">
            {(["CALL_LOG", "EMAIL", "MEETING", "AUTHORITY_CONTACT"] as NoteType[]).map((type) => {
              const Icon = NOTE_ICONS[type];
              return (
                <button
                  key={type}
                  title={NOTE_TYPE_LABELS[type]}
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 hover:border-indigo-300 hover:text-indigo-500 transition-colors"
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              );
            })}
          </div>
          <button className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 transition-colors">
            שמור הערה
          </button>
        </div>
      </div>

      {/* Timeline entries */}
      <div className="flex flex-col gap-2.5">
        {entries.map((entry) => {
          if (entry.kind === "note")   return <NoteCard key={entry.data.id} note={entry.data} />;
          if (entry.kind === "status") return <StatusChangeCard key={entry.data.id} entry={entry.data} />;
          return <ActivityCard key={entry.data.id} activity={entry.data} />;
        })}
      </div>
    </div>
  );
}
