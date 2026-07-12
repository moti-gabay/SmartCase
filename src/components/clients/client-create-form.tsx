"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/actions";
import { GENDER_LABELS, EMPLOYMENT_STATUS_LABELS } from "@/lib/constants";
import type { Gender, EmploymentStatus } from "@/types";
import { ChevronLeft, UserPlus } from "lucide-react";

const field =
  "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100";
const labelCls = "mb-1 block text-xs font-medium text-slate-600";

export function ClientCreateForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [f, setF] = useState({
    fullName: "",
    nationalId: "",
    dateOfBirth: "",
    gender: "MALE" as Gender,
    phone: "",
    email: "",
    addressStreet: "",
    addressCity: "",
    addressZip: "",
    employmentStatus: "UNEMPLOYED" as EmploymentStatus,
    employer: "",
    monthlyIncome: "",
    spouseName: "",
    primaryCondition: "",
    icdCode: "",
    recognizedPercentage: "",
    diagnosisDate: "",
    treatingPhysician: "",
    internalNotes: "",
  });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  const submit = () => {
    setError(null);
    if (f.fullName.trim().length < 2) return setError("יש להזין שם לקוח");
    if (f.nationalId.trim().length < 5) return setError("תעודת זהות לא תקינה");
    if (!f.dateOfBirth) return setError("יש להזין תאריך לידה");
    if (f.phone.trim().length < 3) return setError("יש להזין טלפון");

    startTransition(async () => {
      try {
        const { id } = await createClient({
          fullName: f.fullName.trim(),
          nationalId: f.nationalId.trim(),
          dateOfBirth: f.dateOfBirth,
          gender: f.gender,
          phone: f.phone.trim(),
          email: f.email.trim() || undefined,
          addressStreet: f.addressStreet.trim() || undefined,
          addressCity: f.addressCity.trim() || undefined,
          addressZip: f.addressZip.trim() || undefined,
          employmentStatus: f.employmentStatus,
          employer: f.employer.trim() || undefined,
          monthlyIncome: f.monthlyIncome ? Number(f.monthlyIncome) : undefined,
          spouseName: f.spouseName.trim() || undefined,
          primaryCondition: f.primaryCondition.trim() || undefined,
          icdCode: f.icdCode.trim() || undefined,
          recognizedPercentage: f.recognizedPercentage ? Number(f.recognizedPercentage) : undefined,
          diagnosisDate: f.diagnosisDate || undefined,
          treatingPhysician: f.treatingPhysician.trim() || undefined,
          internalNotes: f.internalNotes.trim() || undefined,
        });
        router.push(`/clients/${id}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "יצירת הלקוח נכשלה");
      }
    });
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header title="לקוח חדש" subtitle="הוספת לקוח חדש למערכת" />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-5">
          <Link href="/clients" className="flex items-center gap-1 text-xs text-slate-500 hover:text-indigo-600">
            <ChevronLeft className="h-3.5 w-3.5 rtl:rotate-180" />
            חזרה לרשימת הלקוחות
          </Link>

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-slate-900">פרטים אישיים</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div><label className={labelCls}>שם מלא *</label><input className={field} value={f.fullName} onChange={(e) => set("fullName", e.target.value)} /></div>
              <div><label className={labelCls}>תעודת זהות *</label><input className={field} value={f.nationalId} onChange={(e) => set("nationalId", e.target.value)} /></div>
              <div><label className={labelCls}>תאריך לידה *</label><input type="date" className={field} value={f.dateOfBirth} onChange={(e) => set("dateOfBirth", e.target.value)} /></div>
              <div>
                <label className={labelCls}>מין</label>
                <select className={field} value={f.gender} onChange={(e) => set("gender", e.target.value)}>
                  {(["MALE", "FEMALE", "OTHER"] as Gender[]).map((g) => <option key={g} value={g}>{GENDER_LABELS[g]}</option>)}
                </select>
              </div>
              <div><label className={labelCls}>טלפון *</label><input className={field} value={f.phone} onChange={(e) => set("phone", e.target.value)} /></div>
              <div><label className={labelCls}>אימייל</label><input type="email" className={field} value={f.email} onChange={(e) => set("email", e.target.value)} /></div>
              <div><label className={labelCls}>רחוב</label><input className={field} value={f.addressStreet} onChange={(e) => set("addressStreet", e.target.value)} /></div>
              <div><label className={labelCls}>עיר</label><input className={field} value={f.addressCity} onChange={(e) => set("addressCity", e.target.value)} /></div>
              <div><label className={labelCls}>מיקוד</label><input className={field} value={f.addressZip} onChange={(e) => set("addressZip", e.target.value)} /></div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-slate-900">תעסוקה ורפואה</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={labelCls}>מצב תעסוקתי</label>
                <select className={field} value={f.employmentStatus} onChange={(e) => set("employmentStatus", e.target.value)}>
                  {(Object.keys(EMPLOYMENT_STATUS_LABELS) as EmploymentStatus[]).map((s) => <option key={s} value={s}>{EMPLOYMENT_STATUS_LABELS[s]}</option>)}
                </select>
              </div>
              <div><label className={labelCls}>מעסיק</label><input className={field} value={f.employer} onChange={(e) => set("employer", e.target.value)} /></div>
              <div><label className={labelCls}>הכנסה חודשית (₪)</label><input type="number" min={0} className={field} value={f.monthlyIncome} onChange={(e) => set("monthlyIncome", e.target.value)} /></div>
              <div><label className={labelCls}>שם בן/בת זוג</label><input className={field} value={f.spouseName} onChange={(e) => set("spouseName", e.target.value)} /></div>
              <div><label className={labelCls}>מצב רפואי עיקרי</label><input className={field} value={f.primaryCondition} onChange={(e) => set("primaryCondition", e.target.value)} /></div>
              <div><label className={labelCls}>קוד ICD</label><input className={field} value={f.icdCode} onChange={(e) => set("icdCode", e.target.value)} /></div>
              <div><label className={labelCls}>אחוז מוכר</label><input type="number" min={0} max={100} className={field} value={f.recognizedPercentage} onChange={(e) => set("recognizedPercentage", e.target.value)} /></div>
              <div><label className={labelCls}>תאריך אבחון</label><input type="date" className={field} value={f.diagnosisDate} onChange={(e) => set("diagnosisDate", e.target.value)} /></div>
              <div className="sm:col-span-2"><label className={labelCls}>רופא מטפל</label><input className={field} value={f.treatingPhysician} onChange={(e) => set("treatingPhysician", e.target.value)} /></div>
              <div className="sm:col-span-2">
                <label className={labelCls}>הערות פנימיות</label>
                <textarea className="min-h-[70px] w-full rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" value={f.internalNotes} onChange={(e) => set("internalNotes", e.target.value)} />
              </div>
            </div>
          </section>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={() => router.push("/clients")} disabled={pending}>ביטול</Button>
            <Button onClick={submit} disabled={pending} className="gap-2">
              {pending ? "יוצר..." : <><UserPlus className="h-4 w-4" /> צור לקוח</>}
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
