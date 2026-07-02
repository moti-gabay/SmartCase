import Link from "next/link";
import { Header } from "@/components/layout/header";
import { DocStatusBadge } from "@/components/ui/badge";
import { getDocuments } from "@/lib/queries";
import { DOCUMENT_TYPE_LABELS } from "@/lib/constants";
import { formatDate } from "@/lib/utils";
import type { DocumentStatus } from "@/types";
import { FileText, Sparkles } from "lucide-react";

export const dynamic = "force-dynamic";

function formatSize(bytes?: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default async function DocumentsPage() {
  const documents = await getDocuments();

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header title="מסמכים" subtitle={`${documents.length} מסמכים במערכת`} />

      <main className="flex-1 overflow-y-auto p-6">
        {documents.length > 0 ? (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                  <th className="px-4 py-3 text-start font-medium">מסמך</th>
                  <th className="px-4 py-3 text-start font-medium">תיק</th>
                  <th className="px-4 py-3 text-start font-medium">לקוח</th>
                  <th className="px-4 py-3 text-start font-medium">סטטוס</th>
                  <th className="px-4 py-3 text-start font-medium">גודל</th>
                  <th className="px-4 py-3 text-start font-medium">AI</th>
                  <th className="px-4 py-3 text-start font-medium">נוצר</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((d) => (
                  <tr key={d.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-slate-400 shrink-0" />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-800">{d.displayName}</p>
                          <p className="text-[11px] text-slate-400">
                            {DOCUMENT_TYPE_LABELS[d.documentType] ?? d.documentType}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/cases/${d.caseId}`} className="font-mono text-xs text-indigo-500 hover:underline">
                        {d.caseNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{d.clientName}</td>
                    <td className="px-4 py-3"><DocStatusBadge status={d.status as DocumentStatus} /></td>
                    <td className="px-4 py-3 text-slate-500">{formatSize(d.fileSize)}</td>
                    <td className="px-4 py-3">
                      {d.isAiReviewed ? (
                        <span className="inline-flex items-center gap-1 text-xs text-violet-600">
                          <Sparkles className="h-3.5 w-3.5" /> נבדק
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">{formatDate(d.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-slate-200 py-20 text-slate-400">
            <FileText className="h-8 w-8 text-slate-300" />
            <p className="text-sm">עדיין לא הועלו מסמכים למערכת</p>
            <p className="text-xs text-slate-300">מסמכים מועלים מתוך עמוד התיק, בטאב &quot;מסמכים&quot;</p>
          </div>
        )}
      </main>
    </div>
  );
}
