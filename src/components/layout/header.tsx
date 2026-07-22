"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, Search, Plus, Loader2, Menu, User, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { CASE_TYPE_LABELS } from "@/lib/constants";
import { useMobileSidebar } from "@/components/layout/mobile-sidebar-context";
import type { CaseStatus, CaseType } from "@/types";

interface HeaderProps {
  title: string;
  subtitle?: string;
}

interface ClientHit { id: string; fullName: string; nationalId: string }
interface CaseHit { id: string; caseNumber: string; caseType: CaseType; status: CaseStatus; clientName: string }

export function Header({ title, subtitle }: HeaderProps) {
  const { setOpen: setMobileSidebarOpen } = useMobileSidebar();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<{ clients: ClientHit[]; cases: CaseHit[] }>({ clients: [], cases: [] });
  const boxRef = useRef<HTMLDivElement>(null);

  // Debounced search
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults({ clients: [], cases: [] });
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (res.ok) setResults(await res.json());
      } catch {
        /* aborted or failed */
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [query]);

  // Close on outside click
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const close = () => { setOpen(false); setQuery(""); };
  const hasResults = results.clients.length > 0 || results.cases.length > 0;
  const showDropdown = open && query.trim().length >= 2;

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-slate-200 bg-white px-6 shadow-sm">
      {/* Mobile nav toggle — hidden md:+, where the sidebar is always visible */}
      <Button
        variant="ghost"
        size="sm"
        className="h-9 w-9 shrink-0 p-0 md:hidden"
        onClick={() => setMobileSidebarOpen(true)}
        aria-label="פתח תפריט ניווט"
      >
        <Menu className="h-5 w-5" />
      </Button>

      {/* Page title */}
      <div className="flex-1 min-w-0">
        <h1 className="text-lg font-semibold text-slate-900 leading-tight">{title}</h1>
        {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
      </div>

      {/* Search */}
      <div ref={boxRef} className="relative hidden md:block">
        <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          type="search"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="חיפוש לקוח, תיק, ת.ז..."
          className="h-9 w-64 rounded-lg border border-slate-200 bg-slate-50 ps-9 pe-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100 transition-all"
        />

        {showDropdown && (
          <div className="absolute end-0 top-full z-40 mt-1.5 max-h-[70vh] w-80 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1.5 shadow-lg">
            {loading && (
              <div className="flex items-center gap-2 px-3 py-3 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" /> מחפש...
              </div>
            )}

            {!loading && !hasResults && (
              <div className="px-3 py-4 text-center text-sm text-slate-400">לא נמצאו תוצאות</div>
            )}

            {!loading && results.clients.length > 0 && (
              <div>
                <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400">לקוחות</p>
                {results.clients.map((c) => (
                  <Link
                    key={c.id}
                    href={`/clients/${c.id}`}
                    onClick={close}
                    className="flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-slate-50"
                  >
                    <User className="h-4 w-4 shrink-0 text-slate-400" />
                    <span className="flex-1 truncate text-slate-800">{c.fullName}</span>
                    <span className="font-mono text-[11px] text-slate-400">{c.nationalId}</span>
                  </Link>
                ))}
              </div>
            )}

            {!loading && results.cases.length > 0 && (
              <div>
                <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400">תיקים</p>
                {results.cases.map((c) => (
                  <Link
                    key={c.id}
                    href={`/cases/${c.id}`}
                    onClick={close}
                    className="flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-slate-50"
                  >
                    <FolderOpen className="h-4 w-4 shrink-0 text-slate-400" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-slate-800">{c.clientName}</p>
                      <p className="font-mono text-[11px] text-slate-400">{c.caseNumber} · {CASE_TYPE_LABELS[c.caseType]}</p>
                    </div>
                    <StatusBadge status={c.status} />
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button className="relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors">
          <Bell className="h-5 w-5" />
          <span className="absolute top-1.5 end-1.5 flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
          </span>
        </button>

        <Link href="/cases/new">
          <Button size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" />
            תיק חדש
          </Button>
        </Link>
      </div>
    </header>
  );
}
