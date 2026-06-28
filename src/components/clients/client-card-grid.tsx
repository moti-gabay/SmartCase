import Link from "next/link";
import { cn, formatDate } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/badge";
import { EMPLOYMENT_STATUS_LABELS, CASE_TYPE_LABELS } from "@/lib/constants";
import type { ClientListItem } from "@/types";
import {
  Phone, Mail, MapPin, Stethoscope,
  AlertTriangle, FolderOpen, Plus,
} from "lucide-react";

const AVATAR_COLORS = [
  "from-indigo-400 to-indigo-600",
  "from-emerald-400 to-emerald-600",
  "from-violet-400 to-violet-600",
  "from-amber-400 to-amber-600",
  "from-rose-400 to-rose-600",
  "from-cyan-400 to-cyan-600",
];

function Avatar({ name, id }: { name: string; id: string }) {
  const gradient = AVATAR_COLORS[id.charCodeAt(2) % AVATAR_COLORS.length];
  const initials = name.split(" ").slice(0, 2).map((p) => p[0]).join("");
  return (
    <div className={cn("flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br text-xl font-bold text-white shadow-md", gradient)}>
      {initials}
    </div>
  );
}

function ClientCard({ client }: { client: ClientListItem }) {
  const age = Math.floor(
    (Date.now() - new Date(client.dateOfBirth).getTime()) / (1000 * 60 * 60 * 24 * 365.25)
  );

  return (
    <div className={cn(
      "group flex flex-col gap-4 rounded-2xl border bg-white p-5 shadow-sm transition-all hover:shadow-md",
      client.hasMissingDocuments ? "border-amber-200" : "border-slate-200"
    )}>
      {/* Header */}
      <div className="flex items-start gap-3">
        <Avatar name={client.fullName} id={client.id} />
        <div className="min-w-0 flex-1">
          <Link
            href={`/clients/${client.id}`}
            className="block text-base font-bold text-slate-900 leading-tight hover:text-indigo-600 transition-colors"
          >
            {client.fullName}
          </Link>
          <p className="mt-0.5 font-mono text-xs text-slate-400">{client.nationalId}</p>
          <p className="text-xs text-slate-400">גיל {age} · {EMPLOYMENT_STATUS_LABELS[client.employmentStatus]}</p>
        </div>
        {client.hasMissingDocuments && (
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" aria-label="מסמכים חסרים" />
        )}
      </div>

      {/* Contact + location */}
      <div className="flex flex-col gap-1.5">
        <Row icon={Phone}    text={client.phone} />
        {client.email     && <Row icon={Mail}     text={client.email} truncate />}
        {client.addressCity && <Row icon={MapPin}   text={client.addressCity} />}
      </div>

      {/* Medical */}
      {client.primaryCondition && (
        <div className="rounded-lg bg-slate-50 px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <Stethoscope className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            <span className="text-xs font-medium text-slate-700 leading-snug">
              {client.primaryCondition}
            </span>
          </div>
          {client.recognizedPercentage !== undefined && (
            <p className="mt-1 text-[11px] font-semibold text-emerald-600 ps-5">
              {client.recognizedPercentage}% מוכר
            </p>
          )}
        </div>
      )}

      {/* Cases */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500">
            {client.activeCasesCount > 0
              ? `${client.activeCasesCount} תיק${client.activeCasesCount > 1 ? "ים" : ""} פעיל${client.activeCasesCount > 1 ? "ים" : ""}`
              : "אין תיקים פעילים"}
          </span>
          {client.lastActivityDate && (
            <span className="text-[11px] text-slate-400">{formatDate(client.lastActivityDate)}</span>
          )}
        </div>
        {client.lastCaseStatus && (
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={client.lastCaseStatus} />
            {client.lastCaseType && (
              <span className="text-[11px] text-slate-400">{CASE_TYPE_LABELS[client.lastCaseType]}</span>
            )}
          </div>
        )}
        {client.hasMissingDocuments && (
          <p className="flex items-center gap-1 text-xs font-medium text-amber-600">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            נדרש טיפול – מסמכים חסרים
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 border-t border-slate-100 pt-3">
        <Link
          href={`/clients/${client.id}`}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 py-2 text-xs font-medium text-slate-600 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 transition-all"
        >
          <FolderOpen className="h-3.5 w-3.5" />
          פרופיל
        </Link>
        <Link
          href={`/cases/new?clientId=${client.id}`}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 py-2 text-xs font-medium text-indigo-700 hover:bg-indigo-100 transition-all"
        >
          <Plus className="h-3.5 w-3.5" />
          תיק חדש
        </Link>
      </div>
    </div>
  );
}

function Row({ icon: Icon, text, truncate }: { icon: React.ElementType; text: string; truncate?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
      <span className={cn("text-xs text-slate-600", truncate && "truncate")}>{text}</span>
    </div>
  );
}

interface ClientCardGridProps {
  clients: ClientListItem[];
}

export function ClientCardGrid({ clients }: ClientCardGridProps) {
  if (clients.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-center">
        <FolderOpen className="h-10 w-10 text-slate-300" />
        <p className="text-sm font-medium text-slate-500">לא נמצאו לקוחות</p>
        <p className="text-xs text-slate-400">נסה לשנות את מונחי החיפוש</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {clients.map((client) => (
        <ClientCard key={client.id} client={client} />
      ))}
    </div>
  );
}
