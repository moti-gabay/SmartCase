"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { PriorityBadge } from "@/components/ui/badge";
import { createTask, toggleTaskStatus } from "@/lib/actions";
import { cn, formatDate } from "@/lib/utils";
import { PRIORITY_LABELS } from "@/lib/constants";
import type { TaskListItem, UserSummary, Priority } from "@/types";
import type { CaseOption } from "@/lib/queries";
import {
  CheckCircle2, Circle, Clock, AlertTriangle, Plus, User, X, ListTodo, ExternalLink,
} from "lucide-react";

type FilterKey = "ALL" | "OPEN" | "OVERDUE" | "COMPLETED";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "ALL", label: "הכל" },
  { key: "OPEN", label: "פתוחות" },
  { key: "OVERDUE", label: "באיחור" },
  { key: "COMPLETED", label: "הושלמו" },
];

export function TasksView({
  tasks,
  agents,
  cases,
}: {
  tasks: TaskListItem[];
  agents: UserSummary[];
  cases: CaseOption[];
}) {
  const [filter, setFilter] = useState<FilterKey>("OPEN");
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [pending, startTransition] = useTransition();

  const stats = useMemo(() => {
    const open = tasks.filter((t) => t.status !== "COMPLETED" && t.status !== "CANCELLED");
    return {
      open: open.length,
      overdue: tasks.filter((t) => t.isOverdue).length,
      completed: tasks.filter((t) => t.status === "COMPLETED").length,
    };
  }, [tasks]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter((t) => {
      if (filter === "OPEN" && (t.status === "COMPLETED" || t.status === "CANCELLED")) return false;
      if (filter === "OVERDUE" && !t.isOverdue) return false;
      if (filter === "COMPLETED" && t.status !== "COMPLETED") return false;
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        t.clientName.toLowerCase().includes(q) ||
        t.caseNumber.toLowerCase().includes(q)
      );
    });
  }, [tasks, filter, search]);

  const handleToggle = (id: string) => {
    startTransition(async () => {
      await toggleTaskStatus(id);
    });
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header title="משימות" subtitle="ניהול משימות לאורך כל התיקים" />

      <main className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-5 p-6">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "משימות פתוחות", value: stats.open, icon: ListTodo, bg: "bg-indigo-50", color: "text-indigo-600" },
              { label: "באיחור", value: stats.overdue, icon: AlertTriangle, bg: "bg-red-50", color: "text-red-600" },
              { label: "הושלמו", value: stats.completed, icon: CheckCircle2, bg: "bg-emerald-50", color: "text-emerald-600" },
            ].map(({ label, value, icon: Icon, bg, color }) => (
              <div key={label} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", bg)}>
                  <Icon className={cn("h-5 w-5", color)} />
                </div>
                <div>
                  <p className="text-2xl font-bold text-slate-900 leading-tight">{value}</p>
                  <p className="text-xs text-slate-500">{label}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {FILTERS.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-medium transition-all",
                    filter === key
                      ? "border-indigo-600 bg-indigo-600 text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:text-indigo-600"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="חיפוש משימה..."
                className="h-9 w-52 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
              <Button size="sm" className="gap-1.5" onClick={() => setShowModal(true)}>
                <Plus className="h-4 w-4" />
                משימה חדשה
              </Button>
            </div>
          </div>

          {/* List */}
          <div className={cn("flex flex-col gap-2", pending && "opacity-60")}>
            {filtered.length > 0 ? (
              filtered.map((t) => <TaskRow key={t.id} task={t} onToggle={handleToggle} />)
            ) : (
              <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-slate-200 py-16 text-slate-400">
                <CheckCircle2 className="h-8 w-8 text-slate-300" />
                <p className="text-sm">אין משימות להצגה</p>
              </div>
            )}
          </div>
        </div>
      </main>

      {showModal && (
        <NewTaskModal agents={agents} cases={cases} onClose={() => setShowModal(false)} />
      )}
    </div>
  );
}

// ─── Task row ─────────────────────────────────────────────────────────────────

function TaskRow({ task, onToggle }: { task: TaskListItem; onToggle: (id: string) => void }) {
  const isCompleted = task.status === "COMPLETED";
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border p-3.5 transition-all",
        isCompleted ? "border-slate-100 bg-slate-50 opacity-70" : "border-slate-200 bg-white",
        task.isOverdue && "border-red-200 bg-red-50/40"
      )}
    >
      <button
        onClick={() => onToggle(task.id)}
        className="mt-0.5 shrink-0 text-slate-300 hover:text-emerald-500 transition-colors"
        aria-label={isCompleted ? "סמן כלא הושלם" : "סמן כהושלם"}
      >
        {isCompleted ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <Circle className="h-5 w-5" />}
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("text-sm font-semibold text-slate-800", isCompleted && "line-through text-slate-400")}>
            {task.title}
          </span>
          <PriorityBadge priority={task.priority} />
        </div>

        {task.description && <p className="mt-1 text-xs text-slate-500 leading-relaxed">{task.description}</p>}

        <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
          <Link
            href={`/cases/${task.caseId}`}
            className="flex items-center gap-1 font-mono text-indigo-500 hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            {task.caseNumber}
          </Link>
          <span>{task.clientName}</span>
          {task.assignedToName && (
            <span className="flex items-center gap-1">
              <User className="h-3 w-3" />
              {task.assignedToName}
            </span>
          )}
          {task.dueDate && (
            <span className={cn("flex items-center gap-1", task.isOverdue && "text-red-600 font-semibold")}>
              {task.isOverdue ? <AlertTriangle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
              {task.isOverdue ? "פג המועד: " : "מועד: "}
              {formatDate(task.dueDate)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── New task modal ───────────────────────────────────────────────────────────

function NewTaskModal({
  agents,
  cases,
  onClose,
}: {
  agents: UserSummary[];
  cases: CaseOption[];
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    caseId: cases[0]?.id ?? "",
    title: "",
    description: "",
    priority: "MEDIUM" as Priority,
    dueDate: "",
    assignedToId: "",
  });

  const submit = () => {
    setError(null);
    if (!form.caseId) return setError("יש לבחור תיק");
    if (form.title.trim().length < 2) return setError("יש להזין כותרת משימה");

    startTransition(async () => {
      try {
        await createTask({
          caseId: form.caseId,
          title: form.title.trim(),
          description: form.description.trim() || undefined,
          priority: form.priority,
          dueDate: form.dueDate || undefined,
          assignedToId: form.assignedToId || undefined,
        });
        onClose();
      } catch {
        setError("שמירת המשימה נכשלה");
      }
    });
  };

  const field = "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">משימה חדשה</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">תיק</label>
            <select
              className={field}
              value={form.caseId}
              onChange={(e) => setForm({ ...form, caseId: e.target.value })}
            >
              {cases.length === 0 && <option value="">אין תיקים זמינים</option>}
              {cases.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.caseNumber} – {c.clientName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">כותרת</label>
            <input
              className={field}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="למשל: לאסוף דו״ח רפואי עדכני"
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

          <div className="grid grid-cols-2 gap-3">
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

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">שיוך לסוכן (אופציונלי)</label>
            <select
              className={field}
              value={form.assignedToId}
              onChange={(e) => setForm({ ...form, assignedToId: e.target.value })}
            >
              <option value="">ללא שיוך</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="mt-2 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose} disabled={pending}>ביטול</Button>
            <Button size="sm" onClick={submit} disabled={pending || cases.length === 0}>
              {pending ? "שומר..." : "צור משימה"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
