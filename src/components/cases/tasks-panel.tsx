"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn, formatDate, isDateOverdue } from "@/lib/utils";
import { PriorityBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { createTask } from "@/lib/actions";
import { TaskEditModal } from "@/components/tasks/task-edit-modal";
import { PRIORITY_LABELS } from "@/lib/constants";
import type { Priority, TaskDetail, TaskStatus, UserSummary } from "@/types";
import { CheckCircle2, Circle, Clock, AlertTriangle, Pencil, Plus, User, X } from "lucide-react";

const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  PENDING:     "ממתין",
  IN_PROGRESS: "בתהליך",
  COMPLETED:   "הושלם",
  CANCELLED:   "בוטל",
};

const TASK_STATUS_COLORS: Record<TaskStatus, string> = {
  PENDING:     "text-slate-500 bg-slate-50 border-slate-200",
  IN_PROGRESS: "text-blue-600 bg-blue-50 border-blue-200",
  COMPLETED:   "text-emerald-600 bg-emerald-50 border-emerald-200",
  CANCELLED:   "text-slate-400 bg-slate-50 border-slate-100 line-through",
};

interface TaskRowProps {
  task: TaskDetail;
  onToggle: (id: string, currentStatus: TaskStatus) => void;
  onEdit: (task: TaskDetail) => void;
}

function TaskRow({ task, onToggle, onEdit }: TaskRowProps) {
  const isDue = task.dueDate && isDateOverdue(task.dueDate) && task.status !== "COMPLETED";
  const isCompleted = task.status === "COMPLETED";

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border p-3.5 transition-all",
        isCompleted ? "border-slate-100 bg-slate-50 opacity-60" : "border-slate-200 bg-white",
        isDue && "border-red-200 bg-red-50/40"
      )}
    >
      {/* Completion toggle */}
      <button
        onClick={() => onToggle(task.id, task.status)}
        className="mt-0.5 shrink-0 text-slate-300 hover:text-emerald-500 transition-colors"
        aria-label={isCompleted ? "סמן כלא הושלם" : "סמן כהושלם"}
      >
        {isCompleted
          ? <CheckCircle2 className="h-5 w-5 text-emerald-500" />
          : <Circle className="h-5 w-5" />}
      </button>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("text-sm font-semibold text-slate-800", isCompleted && "line-through text-slate-400")}>
            {task.title}
          </span>
          <PriorityBadge priority={task.priority} />
          <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium", TASK_STATUS_COLORS[task.status])}>
            {TASK_STATUS_LABELS[task.status]}
          </span>
        </div>

        {task.description && (
          <p className="mt-1 text-xs text-slate-500 leading-relaxed">{task.description}</p>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
          {task.assignedToName && (
            <span className="flex items-center gap-1">
              <User className="h-3 w-3" />
              {task.assignedToName}
            </span>
          )}
          {task.dueDate && (
            <span className={cn("flex items-center gap-1", isDue ? "text-red-600 font-semibold" : "")}>
              {isDue ? <AlertTriangle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
              {isDue ? "פג המועד: " : "מועד: "}
              {formatDate(task.dueDate)}
            </span>
          )}
          {task.completedAt && (
            <span className="text-emerald-600">הושלם: {formatDate(task.completedAt)}</span>
          )}
        </div>
      </div>

      <button
        onClick={() => onEdit(task)}
        className="shrink-0 rounded-lg p-1.5 text-slate-300 hover:bg-slate-100 hover:text-indigo-600 transition-colors"
        aria-label="ערוך משימה"
      >
        <Pencil className="h-4 w-4" />
      </button>
    </div>
  );
}

interface TasksPanelProps {
  tasks: TaskDetail[];
  /** The case every task created here belongs to — fixed, never user-selectable. */
  caseId: string;
  agents: UserSummary[];
}

export function TasksPanel({ tasks: initialTasks, caseId, agents }: TasksPanelProps) {
  const router = useRouter();
  const [tasks, setTasks] = useState(initialTasks);
  const [showCompleted, setShowCompleted] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<TaskDetail | null>(null);

  // The panel seeds local state from props for optimistic toggling, so a server
  // revalidation alone would not surface a newly created task — the state was
  // captured at mount. Resync when fresh props arrive after router.refresh().
  //
  // Adjusted during render rather than in an effect: an effect would render
  // stale rows first and then immediately re-render, and the repo's
  // react-hooks/set-state-in-effect rule rejects it outright. This is React's
  // documented pattern for deriving state from changed props.
  const [seenTasks, setSeenTasks] = useState(initialTasks);
  if (seenTasks !== initialTasks) {
    setSeenTasks(initialTasks);
    setTasks(initialTasks);
  }

  const handleToggle = (id: string, currentStatus: TaskStatus) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === id
          ? {
              ...t,
              status: currentStatus === "COMPLETED" ? "PENDING" : ("COMPLETED" as TaskStatus),
              completedAt: currentStatus !== "COMPLETED" ? new Date().toISOString() : undefined,
            }
          : t
      )
    );
  };

  const active    = tasks.filter((t) => t.status !== "COMPLETED" && t.status !== "CANCELLED");
  const completed = tasks.filter((t) => t.status === "COMPLETED");
  const overdue   = active.filter((t) => t.dueDate && isDateOverdue(t.dueDate));

  return (
    <div className="flex flex-col gap-4">
      {/* Header stats */}
      {overdue.length > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm">
          <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
          <span className="text-red-700 font-medium">
            {overdue.length} משימ{overdue.length === 1 ? "ה" : "ות"} שעבר{overdue.length === 1 ? "ה" : "ו"} המועד
          </span>
        </div>
      )}

      {/* Add task */}
      <button
        type="button"
        onClick={() => setShowModal(true)}
        className="flex items-center gap-2 rounded-xl border-2 border-dashed border-slate-200 p-3.5 text-sm font-medium text-slate-400 hover:border-indigo-300 hover:text-indigo-500 transition-all"
      >
        <Plus className="h-4 w-4" />
        הוסף משימה חדשה
      </button>

      {showModal && (
        <NewCaseTaskModal caseId={caseId} agents={agents} onClose={() => setShowModal(false)} />
      )}

      {editing && (
        <TaskEditModal
          task={editing}
          onClose={() => setEditing(null)}
          // Same prop-resync path as creation: revalidatePath refreshes the
          // server data, router.refresh() re-runs the RSC tree so the panel
          // receives it as new props.
          onSaved={() => router.refresh()}
        />
      )}

      {/* Active tasks */}
      {active.length > 0 && (
        <div className="flex flex-col gap-2">
          {active
            .sort((a, b) => {
              const pOrder = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
              return pOrder[a.priority] - pOrder[b.priority];
            })
            .map((t) => <TaskRow key={t.id} task={t} onToggle={handleToggle} onEdit={setEditing} />)}
        </div>
      )}

      {/* Completed section */}
      {completed.length > 0 && (
        <div>
          <button
            onClick={() => setShowCompleted((v) => !v)}
            className="flex items-center gap-2 text-xs font-medium text-slate-400 hover:text-slate-600 transition-colors mb-2"
          >
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            הושלמו ({completed.length})
          </button>
          {showCompleted && (
            <div className="flex flex-col gap-2">
              {completed.map((t) => <TaskRow key={t.id} task={t} onToggle={handleToggle} onEdit={setEditing} />)}
            </div>
          )}
        </div>
      )}

      {tasks.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-8 text-center text-slate-400">
          <CheckCircle2 className="h-8 w-8 text-slate-300" />
          <p className="text-sm">אין משימות פתוחות לתיק זה</p>
        </div>
      )}
    </div>
  );
}

/**
 * Case-scoped task creation.
 *
 * Mirrors NewTaskModal from tasks-view.tsx with the case <select> removed —
 * caseId arrives fixed from props, which removes a whole class of "saved to the
 * wrong case" mistakes that a defaulted dropdown invites. Deliberately a
 * separate component rather than a shared abstraction: the two modals differ in
 * exactly the field that matters, and the /tasks flow is out of scope here.
 */
function NewCaseTaskModal({
  caseId,
  agents,
  onClose,
}: {
  caseId: string;
  agents: UserSummary[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "",
    description: "",
    priority: "MEDIUM" as Priority,
    dueDate: "",
    assignedToId: "",
  });

  const submit = () => {
    setError(null);
    if (form.title.trim().length < 2) return setError("יש להזין כותרת משימה");

    startTransition(async () => {
      try {
        await createTask({
          caseId,
          title: form.title.trim(),
          description: form.description.trim() || undefined,
          priority: form.priority,
          dueDate: form.dueDate || undefined,
          assignedToId: form.assignedToId || undefined,
        });
        onClose();
        // revalidatePath refreshes the server data; router.refresh() re-runs the
        // RSC tree so the panel receives it as new props.
        router.refresh();
      } catch {
        setError("שמירת המשימה נכשלה");
      }
    });
  };

  const field =
    "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">משימה חדשה</h2>
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
            <Button size="sm" onClick={submit} disabled={pending}>
              {pending ? "שומר..." : "צור משימה"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
