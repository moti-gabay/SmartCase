import { ConversionPortalView } from "@/components/portal/conversion-portal-view";
import { getPortalCaseByToken } from "@/lib/queries";
import { Scale, ShieldAlert } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ConversionPortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const caseView = await getPortalCaseByToken(token);

  if (!caseView) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-950 via-indigo-900 to-indigo-800 p-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-2xl">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-500">
            <ShieldAlert className="h-7 w-7" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">הקישור אינו תקין</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            הקישור שגוי או שפג תוקפו. אנא פנה למשרד לקבלת קישור מעודכן.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white">
            <Scale className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-900">SmartCase</p>
            <p className="text-[11px] text-slate-400">פורטל לקוח – הליך גיור</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        <ConversionPortalView token={token} caseView={caseView} />
      </main>

      <footer className="py-6 text-center text-xs text-slate-400">
        המידע והמסמכים שתעלה כאן מועברים ישירות למשרד המטפל בתיקך.
      </footer>
    </div>
  );
}
