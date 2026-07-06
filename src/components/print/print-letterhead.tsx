import { Scale } from "lucide-react";

interface PrintLetterheadProps {
  subtitle?: string;
  meta?: string;
}

// Branded header shown ONLY inside a printed page (hidden on screen) — see
// the .print-summary / .print-letter rules in globals.css that reveal it.
export function PrintLetterhead({ subtitle, meta }: PrintLetterheadProps) {
  return (
    <div className="hidden print:flex print:flex-col print:gap-1 print:mb-6 print:border-b print:border-slate-300 print:pb-4">
      <div className="flex items-center gap-2">
        <Scale className="h-6 w-6 text-indigo-700" />
        <span className="text-lg font-bold text-slate-900">SmartCase</span>
      </div>
      <p className="text-xs text-slate-500">מערכת ניהול תיקי נכות וביטוח לאומי</p>
      {subtitle && <p className="mt-2 text-base font-semibold text-slate-800">{subtitle}</p>}
      {meta && <p className="text-xs text-slate-500">{meta}</p>}
      <p className="mt-1 text-[11px] text-slate-400">הודפס בתאריך {new Date().toLocaleDateString("he-IL")}</p>
    </div>
  );
}
