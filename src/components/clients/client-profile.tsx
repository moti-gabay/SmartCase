"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { CaseCard } from "@/components/dashboard/case-card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { deleteClient } from "@/lib/actions";
import { formatDate, formatCurrency, calculateAge } from "@/lib/utils";
import { GENDER_LABELS, EMPLOYMENT_STATUS_LABELS } from "@/lib/constants";
import type { ClientDetail } from "@/types";
import {
  ChevronLeft, Pencil, Trash2, Phone, Mail, MapPin, Briefcase,
  Stethoscope, User, Plus, FolderOpen,
} from "lucide-react";

function Row({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value?: React.ReactNode }) {
  if (value == null || value === "") return null;
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
      <div className="min-w-0">
        <p className="text-[11px] text-slate-400">{label}</p>
        <p className="text-sm text-slate-800">{value}</p>
      </div>
    </div>
  );
}

export function ClientProfile({ client }: { client: ClientDetail }) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const age = calculateAge(client.dateOfBirth);

  const handleDelete = () => {
    setError(null);
    startTransition(async () => {
      try {
        await deleteClient(client.id);
        router.push("/clients");
      } catch (e) {
        setError(e instanceof Error ? e.message : "מחיקת הלקוח נכשלה");
        setConfirmOpen(false);
      }
    });
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header title={client.fullName} subtitle={`ת.ז. ${client.nationalId} · גיל ${age}`} />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-4xl flex-col gap-5">
          {/* Breadcrumb + actions */}
          <div className="flex items-center justify-between">
            <Link href="/clients" className="flex items-center gap-1 text-xs text-slate-500 hover:text-indigo-600">
              <ChevronLeft className="h-3.5 w-3.5 rtl:rotate-180" />
              כל הלקוחות
            </Link>
            <div className="flex items-center gap-2">
              <Link href={`/clients/${client.id}/edit`}>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Pencil className="h-3.5 w-3.5" /> עריכה
                </Button>
              </Link>
              <Button variant="danger" size="sm" className="gap-1.5" onClick={() => setConfirmOpen(true)}>
                <Trash2 className="h-3.5 w-3.5" /> מחיקה
              </Button>
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          {/* Details */}
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">פרטים אישיים</h2>
              <Row icon={User} label="מין" value={GENDER_LABELS[client.gender]} />
              <Row icon={User} label="תאריך לידה" value={formatDate(client.dateOfBirth)} />
              <Row icon={Phone} label="טלפון" value={client.phone} />
              <Row icon={Mail} label="אימייל" value={client.email} />
              <Row
                icon={MapPin}
                label="כתובת"
                value={[client.addressStreet, client.addressCity, client.addressZip].filter(Boolean).join(", ") || undefined}
              />
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">תעסוקה ורפואה</h2>
              <Row icon={Briefcase} label="מצב תעסוקתי" value={EMPLOYMENT_STATUS_LABELS[client.employmentStatus]} />
              <Row icon={Briefcase} label="מעסיק" value={client.employer} />
              <Row icon={Briefcase} label="הכנסה חודשית" value={client.monthlyIncome != null ? formatCurrency(client.monthlyIncome) : undefined} />
              <Row icon={Stethoscope} label="מצב רפואי עיקרי" value={client.primaryCondition} />
              <Row
                icon={Stethoscope}
                label="אחוז מוכר"
                value={client.recognizedPercentage != null ? `${client.recognizedPercentage}%` : undefined}
              />
              <Row icon={Stethoscope} label="רופא מטפל" value={client.treatingPhysician} />
            </section>
          </div>

          {/* Cases */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">תיקים ({client.cases.length})</h2>
              <Link href={`/cases/new?clientId=${client.id}`}>
                <Button size="sm" variant="outline" className="gap-1.5">
                  <Plus className="h-3.5 w-3.5" /> תיק חדש
                </Button>
              </Link>
            </div>
            {client.cases.length > 0 ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {client.cases.map((c) => <CaseCard key={c.id} caseItem={c} />)}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-200 py-10 text-slate-400">
                <FolderOpen className="h-7 w-7 text-slate-300" />
                <p className="text-sm">אין תיקים ללקוח זה</p>
              </div>
            )}
          </section>
        </div>
      </main>

      <ConfirmDialog
        open={confirmOpen}
        danger
        title="מחיקת לקוח"
        confirmLabel="מחק לקוח"
        pending={pending}
        message={
          <>
            האם למחוק את <span className="font-semibold">{client.fullName}</span> לצמיתות?
            {client.cases.length > 0 && (
              <span className="mt-2 block font-medium text-red-600">
                פעולה זו תמחק גם {client.cases.length} תיקים משויכים וכל הנתונים שלהם.
              </span>
            )}
          </>
        }
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
