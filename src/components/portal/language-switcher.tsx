"use client";

import { cn } from "@/lib/utils";
import { PORTAL_LOCALES, PORTAL_LOCALE_LABELS, type PortalLocale } from "@/lib/i18n/conversion-portal";
import { Languages } from "lucide-react";

interface LanguageSwitcherProps {
  locale: PortalLocale;
  onChange: (locale: PortalLocale) => void;
}

export function LanguageSwitcher({ locale, onChange }: LanguageSwitcherProps) {
  return (
    <div
      role="group"
      aria-label="Language / שפה / Langue"
      className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm"
    >
      <Languages className="mx-1.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
      {PORTAL_LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => onChange(l)}
          aria-pressed={locale === l}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            locale === l ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-100"
          )}
        >
          {PORTAL_LOCALE_LABELS[l]}
        </button>
      ))}
    </div>
  );
}
