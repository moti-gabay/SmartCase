"use client";

import { useState } from "react";
import { Sidebar } from "@/components/layout/sidebar";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* Sidebar – first in DOM = right side in RTL */}
      <Sidebar isCollapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />

      {/* Main content area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {children}
      </div>
    </div>
  );
}
