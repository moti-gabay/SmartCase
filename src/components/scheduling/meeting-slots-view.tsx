"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatDate, formatDatetime } from "@/lib/utils";
import {
  MIN_SLOT_DURATION_MINUTES,
  MAX_SLOT_DURATION_MINUTES,
} from "@/lib/schemas/meeting-slot-schema";
import {
  AlertCircle,
  AlertTriangle,
  CalendarPlus,
  CalendarRange,
  CheckCircle2,
  Clock,
  Lock,
  MapPin,
  Trash2,
  X,
} from "lucide-react";

// ── Types mirroring the shipped API responses ────────────────────────────────
interface SlotRow {
  id: string;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  location: string | null;
  isPublished: boolean;
  isBooked: boolean;
  bookedCaseId: string | null;
  bookedAt: string | null;
}

interface SkippedEntry {
  startsAt?: string;
  reason: string;
}

interface MutationResponse {
  error?: string;
  created?: { startsAt: string }[];
  skipped?: SkippedEntry[];
}

// ── Constants ────────────────────────────────────────────────────────────────
const LIST_WINDOW_DAYS = 60;

const HEBREW_WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

// Bounded by the schema constants — never hardcode the min/max.
const DURATION_OPTIONS = [15, 20, 30, 45, 60, 90, 120, 180, 240].filter(
  (m) => m >= MIN_SLOT_DURATION_MINUTES && m <= MAX_SLOT_DURATION_MINUTES
);

const NO_PERMISSION = "אין לך הרשאה לנהל מועדי פגישות";
const GENERIC_FAILURE = "אירעה שגיאה בתקשורת עם השרת. נסה שוב.";

const inputClass =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:bg-slate-50";

// `<input type="date">` + `<input type="time">` yield wall-clock strings with no
// zone. `new Date("YYYY-MM-DDTHH:MM")` (no trailing Z) is parsed by the spec as
// *local* time, which is exactly what the staff member meant when they typed it.
// `.toISOString()` then serialises that instant as UTC ("…Z"), an offset form
// `z.iso.datetime({ offset: true })` accepts — so the wall-clock the office sees
// and the instant the DB stores never drift apart, DST included.
function toInstantISO(date: string, time: string): string {
  return new Date(`${date}T${time}`).toISOString();
}

function todayISODate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── Feedback banners ─────────────────────────────────────────────────────────
type Feedback =
  | { kind: "success"; message: string }
  | { kind: "error"; message: string; skipped?: SkippedEntry[] }
  | { kind: "warning"; message: string; skipped: SkippedEntry[] };

function SkippedList({ skipped }: { skipped: SkippedEntry[] }) {
  return (
    <ul className="mt-2 flex flex-col gap-1 text-xs">
      {skipped.map((s, i) => (
        <li key={i} className="flex flex-wrap items-center gap-x-2">
          {s.startsAt && <span className="font-medium">{formatDatetime(s.startsAt)}</span>}
          <span>— {s.reason}</span>
        </li>
      ))}
    </ul>
  );
}

function FeedbackBanner({ feedback, onDismiss }: { feedback: Feedback; onDismiss: () => void }) {
  const styles = {
    success: { box: "bg-emerald-50 text-emerald-700", Icon: CheckCircle2 },
    warning: { box: "bg-amber-50 text-amber-800", Icon: AlertTriangle },
    error: { box: "bg-red-50 text-red-700", Icon: AlertCircle },
  }[feedback.kind];
  const { Icon } = styles;
  const skipped = "skipped" in feedback ? feedback.skipped : undefined;

  return (
    <div className={`flex items-start gap-2.5 rounded-lg p-3 text-sm ${styles.box}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <span>{feedback.message}</span>
        {skipped && skipped.length > 0 && <SkippedList skipped={skipped} />}
      </div>
      <button onClick={onDismiss} aria-label="סגור" className="rounded p-0.5 hover:bg-black/5">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

// ── Shared form field bits ───────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function DurationSelect({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled: boolean;
}) {
  return (
    <select
      className={inputClass}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      {DURATION_OPTIONS.map((m) => (
        <option key={m} value={m}>
          {m} דקות
        </option>
      ))}
    </select>
  );
}

function PublishCheckbox({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
      />
      פרסם מיד ללקוחות
    </label>
  );
}

// ── Single-slot form ─────────────────────────────────────────────────────────
function SingleSlotForm({
  submit,
  pending,
}: {
  submit: (body: unknown) => Promise<void>;
  pending: boolean;
}) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("09:00");
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [location, setLocation] = useState("");
  const [isPublished, setIsPublished] = useState(true);

  const valid = date !== "" && time !== "";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarPlus className="h-4 w-4 text-indigo-600" />
          מועד בודד
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid || pending) return;
            void submit({
              startsAt: toInstantISO(date, time),
              durationMinutes,
              ...(location.trim() ? { location: location.trim() } : {}),
              isPublished,
            });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="תאריך">
              <input type="date" className={inputClass} value={date} min={todayISODate()} disabled={pending} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="שעה">
              <input type="time" className={inputClass} value={time} disabled={pending} onChange={(e) => setTime(e.target.value)} />
            </Field>
            <Field label="משך">
              <DurationSelect value={durationMinutes} onChange={setDurationMinutes} disabled={pending} />
            </Field>
            <Field label="מיקום (רשות)">
              <input type="text" className={inputClass} value={location} maxLength={200} disabled={pending} placeholder="משרד / זום" onChange={(e) => setLocation(e.target.value)} />
            </Field>
          </div>
          <PublishCheckbox checked={isPublished} onChange={setIsPublished} disabled={pending} />
          <div>
            <Button type="submit" size="sm" disabled={!valid || pending}>
              {pending ? "יוצר..." : "צור מועד"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ── Recurring generator form ─────────────────────────────────────────────────
function RecurringSlotsForm({
  submit,
  pending,
}: {
  submit: (body: unknown) => Promise<void>;
  pending: boolean;
}) {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [times, setTimes] = useState<string[]>(["09:00"]);
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [location, setLocation] = useState("");
  const [isPublished, setIsPublished] = useState(true);

  const cleanTimes = times.filter((t) => t !== "");
  const valid = startDate !== "" && endDate !== "" && weekdays.length > 0 && cleanTimes.length > 0;

  function toggleWeekday(d: number) {
    setWeekdays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarRange className="h-4 w-4 text-indigo-600" />
          יצירת מועדים קבועים
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid || pending) return;
            // startDate/endDate stay plain "YYYY-MM-DD" — the generator schema
            // takes calendar days; the clock comes from `timesOfDay`.
            void submit({
              startDate,
              endDate,
              weekdays,
              timesOfDay: cleanTimes,
              durationMinutes,
              ...(location.trim() ? { location: location.trim() } : {}),
              isPublished,
            });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="מתאריך">
              <input type="date" className={inputClass} value={startDate} min={todayISODate()} disabled={pending} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field label="עד תאריך">
              <input type="date" className={inputClass} value={endDate} min={startDate || todayISODate()} disabled={pending} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-500">ימים בשבוע</span>
            <div className="flex flex-wrap gap-2">
              {HEBREW_WEEKDAYS.map((name, day) => {
                const active = weekdays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    disabled={pending}
                    onClick={() => toggleWeekday(day)}
                    aria-pressed={active}
                    className={`rounded-lg border px-3 py-1.5 text-sm transition-colors disabled:opacity-50 ${
                      active
                        ? "border-indigo-300 bg-indigo-50 font-medium text-indigo-700"
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-500">שעות ביום</span>
            <div className="flex flex-wrap items-center gap-2">
              {times.map((t, i) => (
                <div key={i} className="flex items-center gap-1">
                  <input
                    type="time"
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                    value={t}
                    disabled={pending}
                    onChange={(e) => setTimes((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))}
                  />
                  {times.length > 1 && (
                    <button
                      type="button"
                      disabled={pending}
                      aria-label="הסר שעה"
                      onClick={() => setTimes((prev) => prev.filter((_, j) => j !== i))}
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
              <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setTimes((prev) => [...prev, "09:00"])}>
                הוסף שעה
              </Button>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="משך">
              <DurationSelect value={durationMinutes} onChange={setDurationMinutes} disabled={pending} />
            </Field>
            <Field label="מיקום (רשות)">
              <input type="text" className={inputClass} value={location} maxLength={200} disabled={pending} placeholder="משרד / זום" onChange={(e) => setLocation(e.target.value)} />
            </Field>
          </div>

          <PublishCheckbox checked={isPublished} onChange={setIsPublished} disabled={pending} />
          <div>
            <Button type="submit" size="sm" disabled={!valid || pending}>
              {pending ? "יוצר..." : "צור מועדים"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ── Slot row ─────────────────────────────────────────────────────────────────
function SlotItem({
  slot,
  onDelete,
  disabled,
}: {
  slot: SlotRow;
  onDelete: () => void;
  disabled: boolean;
}) {
  const timeRange = `${formatDatetime(slot.startsAt).slice(-5)}–${formatDatetime(slot.endsAt).slice(-5)}`;

  return (
    <li
      className={`flex flex-wrap items-center gap-3 px-4 py-3 ${
        slot.isBooked ? "bg-emerald-50/60" : "hover:bg-slate-50/70"
      }`}
    >
      <div className="flex min-w-40 items-center gap-2 text-sm font-medium text-slate-900">
        <Clock className="h-4 w-4 shrink-0 text-slate-400" />
        <span dir="ltr">{timeRange}</span>
        <span className="text-slate-400">·</span>
        <span className="text-slate-500">{slot.durationMinutes} דק׳</span>
      </div>

      {slot.location && (
        <span className="flex items-center gap-1 text-xs text-slate-500">
          <MapPin className="h-3.5 w-3.5" />
          {slot.location}
        </span>
      )}

      <span
        className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
          slot.isPublished
            ? "border-indigo-200 bg-indigo-50 text-indigo-700"
            : "border-slate-200 bg-slate-100 text-slate-500"
        }`}
      >
        {slot.isPublished ? "מפורסם" : "טיוטה"}
      </span>

      {slot.isBooked && (
        <span className="flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
          <Lock className="h-3 w-3" />
          תפוס{slot.bookedAt ? ` · נקבע ב-${formatDate(slot.bookedAt)}` : ""}
        </span>
      )}

      <div className="ms-auto">
        {!slot.isBooked && (
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={onDelete}
            title="מחיקת מועד"
            className="text-red-600 hover:bg-red-50"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </li>
  );
}

// ── Main view ────────────────────────────────────────────────────────────────
export function MeetingSlotsView() {
  const [slots, setSlots] = useState<SlotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SlotRow | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const loadSlots = useCallback(async () => {
    const from = new Date();
    const to = new Date(from.getTime() + LIST_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const qs = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
      includeUnpublished: "true",
    });
    try {
      const res = await fetch(`/api/staff/meeting-slots?${qs}`);
      if (res.status === 401 || res.status === 403) {
        setFeedback({ kind: "error", message: NO_PERMISSION });
        return;
      }
      if (!res.ok) {
        setFeedback({ kind: "error", message: GENERIC_FAILURE });
        return;
      }
      const data = (await res.json()) as { slots: SlotRow[] };
      setSlots(data.slots);
    } catch {
      setFeedback({ kind: "error", message: GENERIC_FAILURE });
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await loadSlots();
      setLoading(false);
    })();
  }, [loadSlots]);

  // POST handler shared by both forms; maps every documented status to a banner.
  const submit = useCallback(
    async (body: unknown) => {
      setCreating(true);
      setFeedback(null);
      try {
        const res = await fetch("/api/staff/meeting-slots", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (res.status === 401 || res.status === 403) {
          setFeedback({ kind: "error", message: NO_PERMISSION });
          return;
        }

        let data: MutationResponse;
        try {
          data = (await res.json()) as MutationResponse;
        } catch {
          setFeedback({ kind: "error", message: GENERIC_FAILURE });
          return;
        }

        const createdCount = data.created?.length ?? 0;
        const skipped = data.skipped ?? [];

        if (res.status === 201) {
          setFeedback({ kind: "success", message: `${createdCount} מועדים נוצרו` });
          await loadSlots();
          return;
        }
        if (res.status === 207) {
          setFeedback({
            kind: "warning",
            message: `${createdCount} מועדים נוצרו, ${skipped.length} דולגו:`,
            skipped,
          });
          await loadSlots();
          return;
        }
        if (res.status === 400) {
          setFeedback({
            kind: "error",
            message: data.error ?? "הנתונים שהוזנו אינם תקינים",
            skipped: skipped.length > 0 ? skipped : undefined,
          });
          return;
        }
        setFeedback({ kind: "error", message: GENERIC_FAILURE });
      } catch {
        setFeedback({ kind: "error", message: GENERIC_FAILURE });
      } finally {
        setCreating(false);
      }
    },
    [loadSlots]
  );

  const confirmDelete = useCallback(async () => {
    const target = deleteTarget;
    if (!target) return;
    setDeleting(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/staff/meeting-slots?id=${encodeURIComponent(target.id)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setDeleteTarget(null);
        setFeedback({ kind: "success", message: "המועד נמחק" });
        await loadSlots();
        return;
      }
      if (res.status === 401 || res.status === 403) {
        setFeedback({ kind: "error", message: NO_PERMISSION });
      } else if (res.status === 404) {
        setFeedback({ kind: "error", message: "המועד לא נמצא — ייתכן שכבר נמחק" });
        await loadSlots();
      } else if (res.status === 409) {
        setFeedback({ kind: "error", message: "לא ניתן למחוק מועד שכבר נתפס על ידי לקוח" });
        await loadSlots();
      } else if (res.status === 400) {
        const data = (await res.json().catch(() => ({}))) as MutationResponse;
        setFeedback({ kind: "error", message: data.error ?? "בקשת מחיקה לא תקינה" });
      } else {
        setFeedback({ kind: "error", message: GENERIC_FAILURE });
      }
      setDeleteTarget(null);
    } catch {
      setFeedback({ kind: "error", message: GENERIC_FAILURE });
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, loadSlots]);

  // Group chronologically by calendar day (API already returns startsAt asc).
  const groups = useMemo(() => {
    const map = new Map<string, SlotRow[]>();
    for (const slot of slots) {
      const key = formatDate(slot.startsAt);
      const bucket = map.get(key);
      if (bucket) bucket.push(slot);
      else map.set(key, [slot]);
    }
    return [...map.entries()];
  }, [slots]);

  const availableCount = slots.filter((s) => !s.isBooked).length;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header
        title="מועדי פגישות"
        subtitle={`${slots.length} מועדים ב-${LIST_WINDOW_DAYS} הימים הקרובים · ${availableCount} פנויים`}
      />

      <main className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-5 p-6">
          {feedback && <FeedbackBanner feedback={feedback} onDismiss={() => setFeedback(null)} />}

          <div className="grid gap-5 lg:grid-cols-2">
            <SingleSlotForm submit={submit} pending={creating} />
            <RecurringSlotsForm submit={submit} pending={creating} />
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {loading ? (
              <p className="px-4 py-10 text-center text-sm text-slate-400">טוען מועדים...</p>
            ) : groups.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-slate-400">אין מועדים בטווח התאריכים</p>
            ) : (
              groups.map(([day, daySlots]) => (
                <section key={day}>
                  <h3 className="border-y border-slate-100 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-500">
                    {day} · {HEBREW_WEEKDAYS[new Date(daySlots[0].startsAt).getDay()]}
                  </h3>
                  <ul className="divide-y divide-slate-100">
                    {daySlots.map((slot) => (
                      <SlotItem
                        key={slot.id}
                        slot={slot}
                        disabled={deleting}
                        onDelete={() => setDeleteTarget(slot)}
                      />
                    ))}
                  </ul>
                </section>
              ))
            )}
          </div>
        </div>
      </main>

      <ConfirmDialog
        open={!!deleteTarget}
        danger
        title="מחיקת מועד"
        message={
          <>
            למחוק את המועד <strong>{deleteTarget && formatDatetime(deleteTarget.startsAt)}</strong>? המועד
            יוסר מהיומן ולא יוצג עוד ללקוחות.
          </>
        }
        confirmLabel="מחק"
        pending={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
