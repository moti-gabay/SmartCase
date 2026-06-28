"use client";

import { useState } from "react";
import { cn, formatDate, isDateOverdue } from "@/lib/utils";
import { PriorityBadge } from "@/components/ui/badge";
import { PRIORITY_LABELS } from "@/lib/constants";
import type { TaskDetail, TaskStatus } from "@/types";
import { CheckCircle2, Circle, Clock, AlertTriangle, Plus, User } from "lucide-react";

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
}

function TaskRow({ task, onToggle }: TaskRowProps) {
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
    </div>
  );
}

interface TasksPanelProps {
  tasks: TaskDetail[];
}

export function TasksPanel({ tasks: initialTasks }: TasksPanelProps) {
  const [tasks, setTasks] = useState(initialTasks);
  const [showCompleted, setShowCompleted] = useState(false);

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
      <button className="flex items-center gap-2 rounded-xl border-2 border-dashed border-slate-200 p-3.5 text-sm font-medium text-slate-400 hover:border-indigo-300 hover:text-indigo-500 transition-all">
        <Plus className="h-4 w-4" />
        הוסף משימה חדשה
      </button>

      {/* Active tasks */}
      {active.length > 0 && (
        <div className="flex flex-col gap-2">
          {active
            .sort((a, b) => {
              const pOrder = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
              return pOrder[a.priority] - pOrder[b.priority];
            })
            .map((t) => <TaskRow key={t.id} task={t} onToggle={handleToggle} />)}
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
              {completed.map((t) => <TaskRow key={t.id} task={t} onToggle={handleToggle} />)}
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
