import { cn, timeAgo } from "@/lib/utils";
import { CASE_STEP_LABELS } from "@/lib/constants";
import type { CaseSnapshot } from "@/types";
import { Milestone, FileWarning, Activity, CalendarClock, AlertTriangle } from "lucide-react";

// Inactivity thresholds → escalating alert color.
function inactivityLevel(days: number): "none" | "amber" | "red" {
  if (days > 14) return "red";
  if (days > 7) return "amber";
  return "none";
}

const LEVEL_STYLES: Record<"none" | "amber" | "red", { tile: string; value: string; label: string }> = {
  none:  { tile: "border-slate-200 bg-white",       value: "text-slate-900", label: "text-slate-500" },
  amber: { tile: "border-amber-200 bg-amber-50",    value: "text-amber-700", label: "text-amber-600" },
  red:   { tile: "border-red-200 bg-red-50",        value: "text-red-700",   label: "text-red-600" },
};

function Tile({
  icon: Icon,
  label,
  children,
  tone = "neutral",
}: {
  icon: React.ElementType;
  label: string;
  children: React.ReactNode;
  tone?: "neutral" | "amber" | "red";
}) {
  const styles =
    tone === "red" ? LEVEL_STYLES.red : tone === "amber" ? LEVEL_STYLES.amber : LEVEL_STYLES.none;
  return (
    <div className={cn("flex items-start gap-3 rounded-xl border p-3.5", styles.tile)}>
      <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/70", styles.label)}>
        <Icon className="h-4.5 w-4.5" />
      </div>
      <div className="min-w-0">
        <p className={cn("text-[11px] font-medium", styles.label)}>{label}</p>
        <div className={cn("mt-0.5 text-sm font-bold leading-tight", styles.value)}>{children}</div>
      </div>
    </div>
  );
}

export function CaseSnapshotCard({ snapshot }: { snapshot: CaseSnapshot }) {
  const { portalStep, missingDocuments, lastActivityAt, inactivityDays } = snapshot;
  const level = inactivityLevel(inactivityDays);
  const missingCount = missingDocuments.length;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      {/* Header + inactivity alert */}
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold text-slate-800">מבט מהיר על התיק</h2>
        {level !== "none" && (
          <span
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold",
              level === "red"
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-amber-200 bg-amber-50 text-amber-700"
            )}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            ללא פעילות {inactivityDays} ימים
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {/* Current journey state */}
        <Tile icon={Milestone} label="שלב נוכחי">
          {CASE_STEP_LABELS[portalStep] ?? portalStep}
        </Tile>

        {/* Missing / rejected documents */}
        <Tile icon={FileWarning} label="מסמכים חסרים / נדחו" tone={missingCount > 0 ? "amber" : "neutral"}>
          {missingCount === 0 ? (
            <span className="text-emerald-600">אין</span>
          ) : (
            <span title={missingDocuments.map((d) => d.displayName).join(", ")}>
              {missingCount} מסמכים
            </span>
          )}
        </Tile>

        {/* Last activity */}
        <Tile icon={Activity} label="פעילות אחרונה">
          {lastActivityAt ? (
            <span className="font-semibold">{timeAgo(lastActivityAt)}</span>
          ) : (
            <span className="text-slate-400">—</span>
          )}
        </Tile>

        {/* Inactivity counter */}
        <Tile icon={CalendarClock} label="ימי חוסר פעילות" tone={level === "none" ? "neutral" : level}>
          {inactivityDays} <span className="text-xs font-normal">ימים</span>
        </Tile>
      </div>

      {/* Missing docs breakdown */}
      {missingCount > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
          <span className="text-[11px] font-medium text-slate-400">לטיפול:</span>
          {missingDocuments.map((d, i) => (
            <span
              key={`${d.displayName}-${i}`}
              className={cn(
                "rounded-md border px-2 py-0.5 text-[11px] font-medium",
                d.status === "REJECTED"
                  ? "border-red-200 bg-red-50 text-red-700"
                  : "border-amber-200 bg-amber-50 text-amber-700"
              )}
            >
              {d.displayName}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
