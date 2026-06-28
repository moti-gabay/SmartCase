import { Header } from "@/components/layout/header";

export default function CasesPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header title="כל התיקים" subtitle="ניהול ועקיבה אחר תיקים פעילים" />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="flex h-64 items-center justify-center rounded-xl border-2 border-dashed border-slate-200 text-slate-400">
          רשימת תיקים – בפיתוח
        </div>
      </main>
    </div>
  );
}
