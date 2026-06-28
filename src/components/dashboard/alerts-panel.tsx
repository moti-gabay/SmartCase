import Link from "next/link";
import { cn } from "@/lib/utils";
import { AlertTriangle, Clock, FileWarning, Bell, ChevronLeft } from "lucide-react";
import type { AlertItem } from "@/types";

const ALERT_ICONS = {
  missing_docs:  AlertTriangle,
  overdue:       Clock,
  deadline:      Clock,
  decision_due:  Bell,
};

const ALERT_STYLES = {
  high:   { container: "border-red-200 bg-red-50",    icon: "text-red-500 bg-red-100",    dot: "bg-red-500" },
  medium: { container: "border-amber-200 bg-amber-50", icon: "text-amber-500 bg-amber-100", dot: "bg-amber-400" },
  low:    { container: "border-blue-200 bg-blue-50",   icon: "text-blue-500 bg-blue-100",   dot: "bg-blue-400" },
};

interface AlertsPanelProps {
  alerts: AlertItem[];
}

export function AlertsPanel({ alerts }: AlertsPanelProps) {
  const high   = alerts.filter((a) => a.severity === "high");
  const medium = alerts.filter((a) => a.severity === "medium");
  const rest   = alerts.filter((a) => a.severity === "low");

  const ordered = [...high, ...medium, ...rest];

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">
          התראות פעילות
        </h2>
        {alerts.length > 0 && (
          <span className="flex h-5 items-center justify-center rounded-full bg-red-100 px-2 text-xs font-bold text-red-600">
            {alerts.length}
          </span>
        )}
      </div>

      {/* Alert list */}
      {ordered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 py-8 text-center">
          <FileWarning className="h-8 w-8 text-slate-300" />
          <p className="text-sm font-medium text-slate-500">אין התראות פעילות</p>
          <p className="text-xs text-slate-400">כל התיקים מסודרים</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {ordered.map((alert) => {
            const Icon = ALERT_ICONS[alert.type];
            const style = ALERT_STYLES[alert.severity];

            return (
              <Link key={alert.id} href={`/cases/${alert.caseId}`}>
                <div
                  className={cn(
                    "group flex items-start gap-3 rounded-lg border p-3.5 transition-all hover:shadow-sm",
                    style.container
                  )}
                >
                  <div className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full", style.icon)}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-slate-800 leading-tight">
                      {alert.clientName}
                    </p>
                    <p className="text-[11px] font-mono text-slate-400">{alert.caseNumber}</p>
                    <p className="mt-1 text-xs text-slate-600 leading-tight">{alert.message}</p>
                  </div>
                  <ChevronLeft className="mt-1 h-4 w-4 shrink-0 text-slate-400 group-hover:text-slate-600 transition-colors rtl:rotate-180" />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
