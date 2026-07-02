import Link from "next/link";
import { cn, formatDate } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/badge";
import { EMPLOYMENT_STATUS_LABELS, CASE_TYPE_LABELS } from "@/lib/constants";
import type { ClientListItem, SortField, ClientSort } from "@/types";
import {
  ChevronsUpDown, ChevronUp, ChevronDown,
  Phone, Mail, AlertTriangle, FolderOpen,
  Plus, Pencil,
} from "lucide-react";

// ─── Sort header cell ─────────────────────────────────────────────────────────

interface SortHeaderProps {
  field:      SortField;
  label:      string;
  sort:       ClientSort;
  onSort:     (f: SortField) => void;
  className?: string;
}

function SortHeader({ field, label, sort, onSort, className }: SortHeaderProps) {
  const active = sort.field === field;
  const Icon = active
    ? sort.dir === "asc" ? ChevronUp : ChevronDown
    : ChevronsUpDown;

  return (
    <th
      scope="col"
      className={cn("whitespace-nowrap px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500", className)}
    >
      <button
        onClick={() => onSort(field)}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-1 py-0.5 transition-colors hover:bg-slate-100",
          active && "text-indigo-600"
        )}
      >
        {label}
        <Icon className={cn("h-3.5 w-3.5", active ? "text-indigo-500" : "text-slate-300")} />
      </button>
    </th>
  );
}

// ─── Initials avatar ──────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  "bg-indigo-100 text-indigo-700",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-700",
  "bg-violet-100 text-violet-700",
  "bg-rose-100 text-rose-700",
  "bg-cyan-100 text-cyan-700",
];

function Avatar({ name, id }: { name: string; id: string }) {
  const color = AVATAR_COLORS[id.charCodeAt(2) % AVATAR_COLORS.length];
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0])
    .join("");
  return (
    <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold", color)}>
      {initials}
    </span>
  );
}

// ─── Main table ───────────────────────────────────────────────────────────────

interface ClientTableProps {
  clients: ClientListItem[];
  sort:    ClientSort;
  onSort:  (f: SortField) => void;
  emptyMessage: string;
}

export function ClientTable({ clients, sort, onSort, emptyMessage }: ClientTableProps) {
  if (clients.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-center">
        <FolderOpen className="h-10 w-10 text-slate-300" />
        <p className="text-sm font-medium text-slate-500">{emptyMessage}</p>
        <p className="text-xs text-slate-400">נסה לשנות את מונחי החיפוש או הסינון</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[780px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50">
            <SortHeader field="fullName"        label="לקוח"          sort={sort} onSort={onSort} />
            <th scope="col" className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">פרטי קשר</th>
            <th scope="col" className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">מצב רפואי</th>
            <SortHeader field="activeCasesCount" label="תיקים"        sort={sort} onSort={onSort} />
            <SortHeader field="lastActivityDate"  label="פעילות אחרונה" sort={sort} onSort={onSort} />
            <th scope="col" className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">פעולות</th>
          </tr>
        </thead>
        <tbody>
          {clients.map((client, idx) => (
            <TableRow key={client.id} client={client} striped={idx % 2 === 1} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Single row ───────────────────────────────────────────────────────────────

function TableRow({ client, striped }: { client: ClientListItem; striped: boolean }) {
  const age = Math.floor(
    (Date.now() - new Date(client.dateOfBirth).getTime()) / (1000 * 60 * 60 * 24 * 365.25)
  );

  return (
    <tr
      className={cn(
        "group border-b border-slate-100 transition-colors hover:bg-indigo-50/40",
        striped && "bg-slate-50/60"
      )}
    >
      {/* Client identity */}
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-3">
          <Avatar name={client.fullName} id={client.id} />
          <div>
            <Link
              href={`/clients/${client.id}`}
              className="block font-semibold text-slate-900 hover:text-indigo-600 transition-colors leading-tight"
            >
              {client.fullName}
            </Link>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="font-mono text-[11px] text-slate-400">{client.nationalId}</span>
              <span className="text-[11px] text-slate-400">גיל {age}</span>
              {client.addressCity && (
                <span className="text-[11px] text-slate-400">· {client.addressCity}</span>
              )}
            </div>
          </div>
        </div>
      </td>

      {/* Contact */}
      <td className="px-4 py-3.5">
        <div className="flex flex-col gap-0.5">
          <span className="flex items-center gap-1.5 text-sm text-slate-700">
            <Phone className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            {client.phone}
          </span>
          {client.email && (
            <span className="flex items-center gap-1.5 text-xs text-slate-400">
              <Mail className="h-3 w-3 shrink-0" />
              <span className="truncate max-w-[150px]">{client.email}</span>
            </span>
          )}
        </div>
      </td>

      {/* Medical */}
      <td className="px-4 py-3.5">
        <div>
          <p className="text-sm font-medium text-slate-800 leading-tight">
            {client.primaryCondition ?? <span className="text-slate-400 italic">לא צוין</span>}
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            {client.recognizedPercentage !== undefined && (
              <span className="text-[11px] font-semibold text-emerald-600">
                {client.recognizedPercentage}% מוכר
              </span>
            )}
            <span className="text-[11px] text-slate-400">
              {EMPLOYMENT_STATUS_LABELS[client.employmentStatus]}
            </span>
          </div>
        </div>
      </td>

      {/* Cases */}
      <td className="px-4 py-3.5">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className={cn(
              "flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold",
              client.activeCasesCount > 0 ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-500"
            )}>
              {client.activeCasesCount}
            </span>
            <span className="text-xs text-slate-500">
              {client.totalCasesCount > 0
                ? `מתוך ${client.totalCasesCount} סה"כ`
                : "אין תיקים"}
            </span>
          </div>
          {client.lastCaseStatus && (
            <StatusBadge status={client.lastCaseStatus} className="self-start" />
          )}
          {client.lastCaseType && (
            <p className="text-[11px] text-slate-400 leading-tight">
              {CASE_TYPE_LABELS[client.lastCaseType]}
            </p>
          )}
          {client.hasMissingDocuments && (
            <span className="flex items-center gap-1 text-[11px] font-medium text-amber-600">
              <AlertTriangle className="h-3 w-3" />
              מסמכים חסרים
            </span>
          )}
        </div>
      </td>

      {/* Last activity */}
      <td className="px-4 py-3.5">
        <div className="flex flex-col gap-0.5">
          {client.lastActivityDate ? (
            <>
              <span className="text-sm text-slate-700">{formatDate(client.lastActivityDate)}</span>
              {client.assignedAgentName && (
                <span className="text-[11px] text-slate-400">{client.assignedAgentName}</span>
              )}
            </>
          ) : (
            <span className="text-xs text-slate-400 italic">לא צוין</span>
          )}
        </div>
      </td>

      {/* Actions */}
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Link
            href={`/clients/${client.id}`}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 hover:border-indigo-300 hover:text-indigo-600 shadow-sm transition-all"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            פרופיל
          </Link>
          <Link
            href={`/cases/new?clientId=${client.id}`}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:border-indigo-300 hover:text-indigo-600 shadow-sm transition-all"
            aria-label="פתח תיק חדש"
          >
            <Plus className="h-3.5 w-3.5" />
          </Link>
          <Link
            href={`/clients/${client.id}/edit`}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 hover:border-indigo-300 hover:text-indigo-600 shadow-sm transition-all"
            aria-label="עריכת לקוח"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Link>
        </div>
      </td>
    </tr>
  );
}
