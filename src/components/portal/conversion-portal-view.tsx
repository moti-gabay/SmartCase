"use client";

import { useEffect, useRef, useState } from "react";
import { cn, formatDate } from "@/lib/utils";
import type { PortalCaseView, PortalChecklistItem } from "@/lib/queries";
import {
  PORTAL_LOCALE_DIR, portalDict, translateChecklistLabel, type PortalLocale,
} from "@/lib/i18n/conversion-portal";
import { LanguageSwitcher } from "@/components/portal/language-switcher";
import {
  BookOpen, ClipboardList, Send, HeartHandshake, Users2,
  User, Phone, Mail, MapPin, Plus, X, Upload, CheckCircle2,
  AlertTriangle, Loader2, CreditCard, FileBadge, Building2, Camera, FileText,
  Scale, ShieldAlert,
} from "lucide-react";

const DOC_ICONS: Record<string, React.ElementType> = {
  NATIONAL_ID: CreditCard,
  RABBI_LETTER: FileBadge,
  COMMUNITY_LETTER: Building2,
  FAMILY_PHOTO: Camera,
};

const ALLOWED_MIME = ["application/pdf", "image/png", "image/jpeg", "image/jpg"];
const MAX_SIZE = 10 * 1024 * 1024;

const inputCls =
  "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100";
const labelCls = "mb-1 block text-xs font-medium text-slate-600";
const card = "rounded-2xl border border-slate-200 bg-white p-6 shadow-sm";

interface ChildRow {
  fullName: string;
  dateOfBirth: string;
}

// Toggles the shared <html> dir/lang while this page is mounted, restoring the
// app-wide Hebrew/RTL default on unmount. This is a client-side-only toggle
// (no localized routes) — the lightest option that satisfies "switch on the
// fly"; a crawler or no-JS visitor always sees the Hebrew SSR output.
function usePortalDirection(locale: PortalLocale) {
  useEffect(() => {
    document.documentElement.dir = PORTAL_LOCALE_DIR[locale];
    document.documentElement.lang = locale;
    return () => {
      document.documentElement.dir = "rtl";
      document.documentElement.lang = "he";
    };
  }, [locale]);
}

function PortalHeader({ locale, onLocaleChange }: { locale: PortalLocale; onLocaleChange: (l: PortalLocale) => void }) {
  const t = portalDict[locale];
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white">
            <Scale className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-900">SmartCase</p>
            <p className="text-[11px] text-slate-400">{t.portalSubtitle}</p>
          </div>
        </div>
        <LanguageSwitcher locale={locale} onChange={onLocaleChange} />
      </div>
    </header>
  );
}

export function ConversionPortalView({ token, caseView }: { token: string; caseView: PortalCaseView | null }) {
  const [locale, setLocale] = useState<PortalLocale>("he");
  usePortalDirection(locale);
  const t = portalDict[locale];

  if (!caseView) {
    return (
      <div className="flex min-h-screen flex-col bg-slate-50">
        <PortalHeader locale={locale} onLocaleChange={setLocale} />
        <main className="flex flex-1 items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-2xl">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-500">
              <ShieldAlert className="h-7 w-7" />
            </div>
            <h1 className="text-xl font-bold text-slate-900">{t.invalidLinkTitle}</h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">{t.invalidLinkBody}</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <PortalHeader locale={locale} onLocaleChange={setLocale} />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <ConversionPortalForm token={token} caseView={caseView} locale={locale} />
      </main>
      <footer className="py-6 text-center text-xs text-slate-400">{t.footerNote}</footer>
    </div>
  );
}

// ─── The interactive form + upload body (unchanged behavior, now translated) ───

function ConversionPortalForm({
  token,
  caseView,
  locale,
}: {
  token: string;
  caseView: PortalCaseView;
  locale: PortalLocale;
}) {
  const t = portalDict[locale];
  const { client, conversionProfile, checklist } = caseView;

  const [form, setForm] = useState({
    phone: client.phone ?? "",
    email: client.email ?? "",
    addressCity: client.addressCity ?? "",
    spouseFullName: conversionProfile?.spouseFullName ?? "",
    spouseNationalId: conversionProfile?.spouseNationalId ?? "",
    spouseReligion: conversionProfile?.spouseReligion ?? "",
    communityName: conversionProfile?.communityName ?? "",
    sponsoringRabbi: conversionProfile?.sponsoringRabbi ?? "",
    courtName: conversionProfile?.courtName ?? "",
    additionalNotes: conversionProfile?.additionalNotes ?? "",
  });
  const [children, setChildren] = useState<ChildRow[]>(
    conversionProfile?.children.map((c) => ({ fullName: c.fullName, dateOfBirth: c.dateOfBirth?.slice(0, 10) ?? "" })) ?? []
  );
  const set = (k: keyof typeof form, v: string) => setForm((p) => ({ ...p, [k]: v }));

  // Honeypot: a field real visitors never see or fill, but naive bots that
  // auto-fill every form input do. If it arrives non-empty, the server rejects
  // the submission outright. Off-screen (not display:none) + tabIndex=-1 +
  // aria-hidden so screen-reader/keyboard users never encounter it either.
  // Deliberately NOT translated/localized — it's invisible in every language
  // by design, and its English field name is what naive spam bots target.
  const [honeypot, setHoneypot] = useState("");

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [items, setItems] = useState<PortalChecklistItem[]>(checklist);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingItemId = useRef<string | null>(null);

  const addChild = () => setChildren((c) => [...c, { fullName: "", dateOfBirth: "" }]);
  const removeChild = (i: number) => setChildren((c) => c.filter((_, idx) => idx !== i));
  const setChild = (i: number, k: keyof ChildRow, v: string) =>
    setChildren((c) => c.map((row, idx) => (idx === i ? { ...row, [k]: v } : row)));

  // NOTE (i18n scope, point 5): the payload shape below — field names, JSON
  // structure, endpoints — is completely independent of `locale`. Only the
  // on-screen labels are translated; the wire format sent to
  // /api/public/conversion/... is byte-for-byte the same regardless of which
  // language is selected in the UI.
  const submitProfile = async () => {
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      const res = await fetch(`/api/public/conversion/${token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          children: children.filter((c) => c.fullName.trim()),
          honeypot,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? t.saveErrorFallback);
      }
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t.saveErrorFallback);
    } finally {
      setSaving(false);
    }
  };

  const triggerUpload = (itemId: string) => {
    setUploadError(null);
    pendingItemId.current = itemId;
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const checklistItemId = pendingItemId.current;
    e.target.value = "";
    if (!file || !checklistItemId) return;

    if (file.size > MAX_SIZE) {
      setUploadError(t.fileTooLarge);
      pendingItemId.current = null;
      return;
    }
    if (!ALLOWED_MIME.includes(file.type)) {
      setUploadError(t.fileTypeInvalid);
      pendingItemId.current = null;
      return;
    }

    setUploadingId(checklistItemId);
    setUploadError(null);
    try {
      const presignRes = await fetch(`/api/public/conversion/${token}/presign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checklistItemId,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type,
        }),
      });
      if (!presignRes.ok) {
        const data = await presignRes.json().catch(() => ({}));
        throw new Error(data.error ?? t.uploadFailedFallback);
      }
      const { documentId, upload } = await presignRes.json();

      const putRes = await fetch(upload.url, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!putRes.ok) throw new Error(t.uploadFailedFallback);

      const confirmRes = await fetch(`/api/public/conversion/${token}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId, checklistItemId }),
      });
      if (!confirmRes.ok) {
        const data = await confirmRes.json().catch(() => ({}));
        throw new Error(data.error ?? t.uploadFailedFallback);
      }

      setItems((prev) => prev.map((it) => (it.id === checklistItemId ? { ...it, status: "UPLOADED_PENDING_REVIEW" } : it)));
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : t.uploadFailedFallback);
    } finally {
      setUploadingId(null);
      pendingItemId.current = null;
    }
  };

  const age = Math.floor((Date.now() - new Date(client.dateOfBirth).getTime()) / (1000 * 60 * 60 * 24 * 365.25));

  return (
    <div className="flex flex-col gap-6">
      {/* Honeypot — invisible to real users, see comment above the state. */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", top: "-9999px" }}>
        <label htmlFor="website">Website</label>
        <input
          type="text"
          id="website"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
        />
      </div>

      <input ref={fileInputRef} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png" onChange={handleFileSelected} />

      {/* Explainer */}
      <div className={cn(card, "bg-gradient-to-br from-indigo-50 to-white")}>
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white">
            <BookOpen className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900">{t.welcomeTitle}</h1>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{t.welcomeBody}</p>
            <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              {[
                { icon: ClipboardList, text: t.step1 },
                { icon: HeartHandshake, text: t.step2 },
                { icon: CheckCircle2, text: t.step3 },
              ].map(({ icon: Icon, text }) => (
                <div key={text} className="flex items-center gap-2 rounded-lg bg-white/70 px-3 py-2 text-xs font-medium text-indigo-800">
                  <Icon className="h-4 w-4 shrink-0" />
                  {text}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Personal details */}
      <div className={card}>
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-900">
          <User className="h-4 w-4 text-slate-400" /> {t.personalTitle}
        </h2>
        <div className="mb-4 grid grid-cols-1 gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-3">
          <div><p className="text-[11px] text-slate-400">{t.fullName}</p><p className="text-sm font-medium text-slate-800">{client.fullName}</p></div>
          <div><p className="text-[11px] text-slate-400">{t.nationalId}</p><p className="font-mono text-sm font-medium text-slate-800">{client.nationalId}</p></div>
          <div><p className="text-[11px] text-slate-400">{t.dateOfBirth}</p><p className="text-sm font-medium text-slate-800">{formatDate(client.dateOfBirth)} ({t.age} {age})</p></div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className={labelCls}><Phone className="me-1 inline h-3.5 w-3.5" />{t.phone}</label>
            <input className={inputCls} value={form.phone} onChange={(e) => set("phone", e.target.value)} />
          </div>
          <div>
            <label className={labelCls}><Mail className="me-1 inline h-3.5 w-3.5" />{t.email}</label>
            <input type="email" className={inputCls} value={form.email} onChange={(e) => set("email", e.target.value)} />
          </div>
          <div>
            <label className={labelCls}><MapPin className="me-1 inline h-3.5 w-3.5" />{t.addressCity}</label>
            <input className={inputCls} value={form.addressCity} onChange={(e) => set("addressCity", e.target.value)} />
          </div>
        </div>
      </div>

      {/* Spouse & family */}
      <div className={card}>
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Users2 className="h-4 w-4 text-slate-400" /> {t.familyTitle}
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label className={labelCls}>{t.spouseFullName}</label><input className={inputCls} value={form.spouseFullName} onChange={(e) => set("spouseFullName", e.target.value)} /></div>
          <div><label className={labelCls}>{t.spouseNationalId}</label><input className={inputCls} value={form.spouseNationalId} onChange={(e) => set("spouseNationalId", e.target.value)} /></div>
          <div><label className={labelCls}>{t.spouseReligion}</label><input className={inputCls} value={form.spouseReligion} onChange={(e) => set("spouseReligion", e.target.value)} /></div>
          <div><label className={labelCls}>{t.communityName}</label><input className={inputCls} value={form.communityName} onChange={(e) => set("communityName", e.target.value)} /></div>
          <div><label className={labelCls}>{t.sponsoringRabbi}</label><input className={inputCls} value={form.sponsoringRabbi} onChange={(e) => set("sponsoringRabbi", e.target.value)} /></div>
          <div><label className={labelCls}>{t.courtName}</label><input className={inputCls} value={form.courtName} onChange={(e) => set("courtName", e.target.value)} /></div>
        </div>

        {/* Children */}
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <label className={labelCls}>{t.childrenLabel}</label>
            <button type="button" onClick={addChild} className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline">
              <Plus className="h-3.5 w-3.5" /> {t.addChild}
            </button>
          </div>
          {children.length === 0 && <p className="text-xs text-slate-400">{t.noChildren}</p>}
          <div className="flex flex-col gap-2">
            {children.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  className={inputCls}
                  placeholder={t.childNamePlaceholder}
                  value={c.fullName}
                  onChange={(e) => setChild(i, "fullName", e.target.value)}
                />
                <input
                  type="date"
                  className={cn(inputCls, "max-w-[160px]")}
                  value={c.dateOfBirth}
                  onChange={(e) => setChild(i, "dateOfBirth", e.target.value)}
                />
                <button type="button" onClick={() => removeChild(i)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div>
          <label className={cn(labelCls, "mt-4")}>{t.additionalNotes}</label>
          <textarea
            className="min-h-[80px] w-full rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            value={form.additionalNotes}
            onChange={(e) => set("additionalNotes", e.target.value)}
          />
        </div>

        {saveError && <p className="mt-3 text-sm text-red-600">{saveError}</p>}
        {saved && <p className="mt-3 flex items-center gap-1.5 text-sm text-emerald-600"><CheckCircle2 className="h-4 w-4" /> {t.saveSuccess}</p>}

        <div className="mt-4 flex justify-end">
          <button
            onClick={submitProfile}
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {saving ? t.saving : t.saveButton}
          </button>
        </div>
      </div>

      {/* Documents */}
      <div className={card}>
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-900">
          <FileText className="h-4 w-4 text-slate-400" /> {t.documentsTitle}
        </h2>
        <p className="mb-4 text-xs text-slate-400">{t.documentsHint}</p>

        {uploadError && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
            <AlertTriangle className="h-4 w-4 shrink-0" /> {uploadError}
          </div>
        )}

        <div className="flex flex-col gap-2.5">
          {items.map((item) => {
            const Icon = DOC_ICONS[item.documentType] ?? FileText;
            const isDone = item.status !== "MISSING" && item.status !== "REJECTED" && item.status !== "PENDING_UPLOAD";
            const isUploading = uploadingId === item.id;
            const label = translateChecklistLabel(locale, item.documentType, item.displayName);
            return (
              <div
                key={item.id}
                className={cn(
                  "flex items-center gap-3 rounded-xl border p-3.5",
                  isDone ? "border-emerald-100 bg-emerald-50/40" : "border-slate-200 bg-white"
                )}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-100 bg-white shadow-sm">
                  <Icon className="h-4.5 w-4.5 text-slate-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-800">{label}</span>
                    {item.isMandatory
                      ? <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-500 border border-red-200">{t.mandatory}</span>
                      : <span className="rounded bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-400 border border-slate-200">{t.optional}</span>}
                  </div>
                </div>
                <button
                  onClick={() => triggerUpload(item.id)}
                  disabled={isUploading}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors",
                    isDone ? "border border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50" : "bg-indigo-600 text-white hover:bg-indigo-700",
                    isUploading && "opacity-60"
                  )}
                >
                  {isUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : isDone ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Upload className="h-3.5 w-3.5" />}
                  {isUploading ? t.uploading : isDone ? t.uploaded : t.upload}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
