import { cn } from "@/lib/utils";

interface ProgressProps {
  value: number;      // 0–100
  className?: string;
  barClassName?: string;
  size?: "sm" | "md";
}

export function Progress({ value, className, barClassName, size = "md" }: ProgressProps) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      className={cn(
        "w-full overflow-hidden rounded-full bg-slate-100",
        size === "sm" ? "h-1.5" : "h-2.5",
        className
      )}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn(
          "h-full rounded-full transition-all duration-500",
          clamped === 100
            ? "bg-emerald-500"
            : clamped >= 60
              ? "bg-indigo-500"
              : clamped >= 30
                ? "bg-amber-500"
                : "bg-red-500",
          barClassName
        )}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
