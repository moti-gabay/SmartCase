"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  FolderOpen,
  Users,
  CheckSquare,
  FileText,
  Sparkles,
  Settings,
  LogOut,
  Scale,
  ChevronLeft,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/dashboard",  label: "לוח בקרה",   icon: LayoutDashboard },
  { href: "/cases",      label: "תיקים",       icon: FolderOpen },
  { href: "/clients",    label: "לקוחות",      icon: Users },
  { href: "/tasks",      label: "משימות",      icon: CheckSquare },
  { href: "/documents",  label: "מסמכים",      icon: FileText },
  { href: "/ai-tools",   label: "כלי AI",      icon: Sparkles },
] as const;

const BOTTOM_ITEMS = [
  { href: "/settings", label: "הגדרות", icon: Settings },
] as const;

interface SidebarProps {
  isCollapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ isCollapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        "relative flex h-full flex-col border-s border-white/10 bg-[#1e1b4b] transition-all duration-300",
        isCollapsed ? "w-16" : "w-60"
      )}
    >
      {/* Logo */}
      <div className="flex h-16 items-center gap-3 px-4 border-b border-white/10">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500 shadow-lg">
          <Scale className="h-5 w-5 text-white" />
        </div>
        {!isCollapsed && (
          <div className="min-w-0">
            <p className="text-sm font-bold text-white leading-tight">SmartCase</p>
            <p className="text-[11px] text-indigo-300">ניהול תיקי נכות</p>
          </div>
        )}
      </div>

      {/* Collapse toggle */}
      <button
        onClick={onToggle}
        className="absolute -start-3 top-20 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-white/20 bg-[#1e1b4b] text-indigo-300 shadow-md hover:bg-[#2d2a7a] hover:text-white transition-colors"
        aria-label={isCollapsed ? "הרחב תפריט" : "כווץ תפריט"}
      >
        <ChevronLeft className={cn("h-3.5 w-3.5 transition-transform", isCollapsed && "rotate-180")} />
      </button>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-0.5">
        {!isCollapsed && (
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-indigo-400">
            ניווט
          </p>
        )}
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              title={isCollapsed ? label : undefined}
              className={cn(
                "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                isActive
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-indigo-200 hover:bg-white/10 hover:text-white"
              )}
            >
              <Icon className="h-5 w-5 shrink-0" />
              {!isCollapsed && <span className="truncate">{label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Bottom section */}
      <div className="border-t border-white/10 p-2 space-y-0.5">
        {BOTTOM_ITEMS.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            title={isCollapsed ? label : undefined}
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-indigo-200 hover:bg-white/10 hover:text-white transition-all"
          >
            <Icon className="h-5 w-5 shrink-0" />
            {!isCollapsed && <span>{label}</span>}
          </Link>
        ))}
        <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-indigo-200 hover:bg-white/10 hover:text-red-300 transition-all">
          <LogOut className="h-5 w-5 shrink-0" />
          {!isCollapsed && <span>התנתק</span>}
        </button>
      </div>

      {/* Agent badge */}
      {!isCollapsed && (
        <div className="border-t border-white/10 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-xs font-bold text-white">
              מג
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">מגי כהן</p>
              <p className="text-[11px] text-indigo-400">סוכן</p>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
