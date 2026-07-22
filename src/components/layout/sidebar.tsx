"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import { useMobileSidebar } from "@/components/layout/mobile-sidebar-context";
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
  ShieldCheck,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/dashboard",  label: "לוח בקרה",   icon: LayoutDashboard },
  { href: "/cases",      label: "תיקים",       icon: FolderOpen },
  { href: "/clients",    label: "לקוחות",      icon: Users },
  { href: "/tasks",      label: "משימות",      icon: CheckSquare },
  { href: "/documents",  label: "מסמכים",      icon: FileText },
  { href: "/ai-tools",   label: "כלי AI",      icon: Sparkles },
] as const;

// Admin-only nav entry, rendered conditionally on session role.
const ADMIN_ITEM = { href: "/admin/users", label: "ניהול משתמשים", icon: ShieldCheck } as const;

const BOTTOM_ITEMS = [
  { href: "/settings", label: "הגדרות", icon: Settings },
] as const;

interface SidebarProps {
  isCollapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ isCollapsed, onToggle }: SidebarProps) {
  const pathname   = usePathname();
  const router     = useRouter();
  const { data: session } = useSession();
  const { open: mobileOpen, setOpen: setMobileOpen } = useMobileSidebar();
  const closeMobile = () => setMobileOpen(false);

  const userName    = session?.user?.name  ?? "משתמש";
  const userEmail   = session?.user?.email ?? "";
  const isAdmin     = session?.user?.role === "ADMIN";
  const initials    = userName.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  // Escape closes the mobile drawer (desktop is unaffected — mobileOpen has
  // no bearing on the always-visible md:+ layout).
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMobileOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen, setMobileOpen]);

  return (
    <>
      {/* Backdrop — mobile drawer only; md:hidden guarantees it disappears
          on desktop even if mobileOpen was left true after a resize. */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40 md:hidden"
          onClick={closeMobile}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          "flex h-full w-60 flex-col border-s border-white/10 bg-[#1e1b4b] transition-transform duration-300",
          // Mobile: fixed overlay drawer, off-canvas by default.
          "fixed inset-y-0 start-0 z-50",
          mobileOpen ? "translate-x-0" : "translate-x-full",
          // Desktop: back in normal flow, always visible, respects collapse width.
          "md:relative md:z-auto md:translate-x-0 md:transition-[width]",
          isCollapsed ? "md:w-16" : "md:w-60"
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

        {/* Collapse toggle — desktop only; mobile uses the hamburger/backdrop/Escape instead. */}
        <button
          onClick={onToggle}
          className="absolute -start-3 top-20 z-10 hidden h-6 w-6 items-center justify-center rounded-full border border-white/20 bg-[#1e1b4b] text-indigo-300 shadow-md hover:bg-[#2d2a7a] hover:text-white transition-colors md:flex"
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
                onClick={closeMobile}
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

          {isAdmin && (() => {
            const { href, label, icon: Icon } = ADMIN_ITEM;
            const isActive = pathname === href || pathname.startsWith(href + "/");
            return (
              <Link
                href={href}
                title={isCollapsed ? label : undefined}
                onClick={closeMobile}
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
          })()}
        </nav>

        {/* Bottom section */}
        <div className="border-t border-white/10 p-2 space-y-0.5">
          {BOTTOM_ITEMS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              title={isCollapsed ? label : undefined}
              onClick={closeMobile}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-indigo-200 hover:bg-white/10 hover:text-white transition-all"
            >
              <Icon className="h-5 w-5 shrink-0" />
              {!isCollapsed && <span>{label}</span>}
            </Link>
          ))}
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-indigo-200 hover:bg-white/10 hover:text-red-300 transition-all"
          >
            <LogOut className="h-5 w-5 shrink-0" />
            {!isCollapsed && <span>התנתק</span>}
          </button>
        </div>

        {/* Logged-in user badge */}
        {!isCollapsed && (
          <div className="border-t border-white/10 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-xs font-bold text-white">
                {initials || "?"}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-white">{userName}</p>
                <p className="truncate text-[11px] text-indigo-400">{userEmail}</p>
              </div>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
