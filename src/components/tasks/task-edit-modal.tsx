"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { PRIORITY_LABELS } from "@/lib/constants";
import type { Priority, TaskStatus } from "@/types";
import { AlertTriangle, Trash2, X } from "lucide-react";

// Shared edit + delete dialog for both task surfaces (/tasks list and the case
// tasks panel). Unlike the two creation modals — which differ in the one field
// that matters (case selection) and are deliberately separate — editing is
// identical everywhere, so it lives once here.
//
// Assignment is intentionally not editable: the list payloads carry only
// `assignedToName`, and reassignment is a separate concern from the field edit
// this dialog covers.

const STATUS_LABELS: Record<TaskStatus, string> = {
  PENDING: "ממתין",
  IN_PROGRESS: "בתהליך",
  COMPLETED: "הושלם",
  CANCELLED: "בוטל",
};

export interface EditableTask {
  id: string;
  title: string;
  description?: string | null;
  priority: Priority;
  status: TaskStatus;
  dueDate?: string | null;
}

// The API takes ISO / "YYYY-MM-DD"; <input type="date"> only speaks the latter.
function toDateInput(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

export function TaskEditModal({
  task,
  onClose,
  onSaved,
}: {
  task: EditableTask;
  onClose: () => void;
  /** Called after a successful save or delete so the caller can refresh. */
  onSaved: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [form, setForm] = useState({
    title: task.title,
    description: task.description ?? "",
    priority: task.priority,
    status: task.status,
    dueDate: toDateInput(task.dueDate),
  });

  const submit = () => {
    setError(null);
    if (form.title.trim().length < 2) return setError("יש להזין כותרת משימה");

    startTransition(async () => {
      try {
        const res = await fetch(`/api/tasks/${task.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: form.title.trim(),
            description: form.description.trim() || null,
            priority: form.priority,
            status: form.status,
            dueDate: form.dueDate || null,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          return setError(body?.error ?? "עדכון המשימה נכשל");
        }
        onSaved();
        onClose();
      } catch {
        setError("עדכון המשימה נכשל");
      }
    });
  };

  const remove = () => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/tasks/${task.id}`, { method: "DELETE" });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          return setError(body?.error ?? "מחיקת המשימה נכשלה");
        }
        onSaved();
        onClose();
      } catch {
        setError("מחיקת המשימה נכשלה");
      }
    });
  };

  const field =
    "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">עריכת משימה</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">כותרת</label>
            <input
              className={field}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">תיאור (אופציונלי)</label>
            <textarea
              className="min-h-[70px] w-full rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">סטטוס</label>
              <select
                className={field}
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as TaskStatus })}
              >
                {(Object.keys(STATUS_LABELS) as TaskStatus[]).map((s) => (
                  <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">עדיפות</label>
              <select
                className={field}
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value as Priority })}
              >
                {(["LOW", "MEDIUM", "HIGH", "URGENT"] as Priority[]).map((p) => (
                  <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">מועד יעד</label>
              <input
                type="date"
                className={field}
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              />
            </div>
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          {confirmDelete ? (
            <div className="mt-2 flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
              <p className="flex items-center gap-2 text-xs font-medium text-red-700">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                מחיקת המשימה היא פעולה בלתי הפיכה. להמשיך?
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setConfirmDelete(false)} disabled={pending}>
                  ביטול
                </Button>
                <Button size="sm" onClick={remove} disabled={pending} className="bg-red-600 hover:bg-red-700">
                  {pending ? "מוחק..." : "מחק לצמיתות"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-2 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                disabled={pending}
                className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
                מחק משימה
              </button>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={onClose} disabled={pending}>ביטול</Button>
                <Button size="sm" onClick={submit} disabled={pending}>
                  {pending ? "שומר..." : "שמור שינויים"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
