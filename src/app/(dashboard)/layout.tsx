"use client";

import { useState } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { AssistantDrawer } from "@/components/ai/assistant-drawer";
import { MobileSidebarProvider } from "@/components/layout/mobile-sidebar-context";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <MobileSidebarProvider>
      <div className="flex h-screen overflow-hidden bg-slate-50">
        {/* Sidebar – first in DOM = right side in RTL */}
        <Sidebar isCollapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />

        {/* Main content area */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {children}
        </div>

        <AssistantDrawer />
      </div>
    </MobileSidebarProvider>
  );
}
