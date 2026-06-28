import { cn } from "@/lib/utils";
import { ChevronRight, ChevronLeft } from "lucide-react";

interface PaginationProps {
  page:       number;
  totalPages: number;
  total:      number;
  perPage:    number;
  perPageOptions: readonly number[];
  onPageChange:    (p: number) => void;
  onPerPageChange: (n: number) => void;
}

export function Pagination({
  page, totalPages, total, perPage, perPageOptions,
  onPageChange, onPerPageChange,
}: PaginationProps) {
  const start = Math.min((page - 1) * perPage + 1, total);
  const end   = Math.min(page * perPage, total);

  // Build visible page numbers (max 5, centered around current)
  const pages: (number | "…")[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3)          pages.push("…");
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
    if (page < totalPages - 2) pages.push("…");
    pages.push(totalPages);
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-3">
      {/* Count summary */}
      <p className="text-sm text-slate-500">
        מציג <span className="font-semibold text-slate-700">{start}–{end}</span> מתוך{" "}
        <span className="font-semibold text-slate-700">{total}</span> לקוחות
      </p>

      <div className="flex items-center gap-3">
        {/* Per-page selector */}
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <span>שורות:</span>
          <select
            value={perPage}
            onChange={(e) => onPerPageChange(Number(e.target.value))}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
          >
            {perPageOptions.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>

        {/* Page buttons */}
        <nav className="flex items-center gap-1" aria-label="ניווט עמודים">
          {/* RTL: right arrow = previous page */}
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="עמוד קודם"
          >
            <ChevronRight className="h-4 w-4" />
          </button>

          {pages.map((p, i) =>
            p === "…" ? (
              <span key={`ellipsis-${i}`} className="px-1 text-slate-400 select-none">…</span>
            ) : (
              <button
                key={p}
                onClick={() => onPageChange(p as number)}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-lg text-sm font-medium transition-colors",
                  p === page
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "border border-slate-200 text-slate-600 hover:bg-slate-50"
                )}
                aria-current={p === page ? "page" : undefined}
              >
                {p}
              </button>
            )
          )}

          {/* RTL: left arrow = next page */}
          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="עמוד הבא"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        </nav>
      </div>
    </div>
  );
}
