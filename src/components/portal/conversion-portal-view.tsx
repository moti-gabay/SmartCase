"use client";

import { useEffect, useRef, useState } from "react";
import type { PortalCaseView, PortalChecklistItem, PortalReference } from "@/lib/queries";
import { PORTAL_LOCALE_DIR, portalDict, type PortalLocale } from "@/lib/i18n/conversion-portal";
import { CASE_STEP_ORDER, canAdvance, isClientAdvanceable, type JourneySnapshot } from "@/lib/portal/journey";
import type { CaseStep } from "@/types";
import { LanguageSwitcher } from "@/components/portal/language-switcher";
import {
  WizardProgress, WelcomeBody, OverviewBody, PersonalBody, FamilyBody, BackgroundBody,
  StoryBody, ReferencesBody, DocumentsBody, PassiveBody,
  type PortalForm, type ChildRow, type ReferenceDraft,
} from "@/components/portal/portal-screens";
import { Scale, ShieldAlert, Loader2, ArrowLeft } from "lucide-react";

const ALLOWED_MIME = ["application/pdf", "image/png", "image/jpeg", "image/jpg"];
const MAX_SIZE = 10 * 1024 * 1024;

// Data-entry slices persist to the DB via /submit before /advance can pass the
// server guard. Zero-input screens (WELCOME/PROCESS_OVERVIEW) and PENDING_DOCS
// (already persisted through the upload confirm) advance without a save.
const DATA_SLICES = new Set<CaseStep>(["WIZARD_PERSONAL", "WIZARD_FAMILY", "WIZARD_BACKGROUND", "PERSONAL_STORY"]);

// Toggles the shared <html> dir/lang while this page is mounted, restoring the
// app-wide Hebrew/RTL default on unmount (client-side-only; no localized routes).
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
  // Seeded from the client's persisted Client.locale (already normalized to a
  // PortalLocale in getPortalCaseByToken), so a returning client lands in their
  // own language instead of always starting at Hebrew. An invalid/expired link
  // has no client to read, so it falls back to the office default.
  const [locale, setLocale] = useState<PortalLocale>(caseView?.client.locale ?? "he");
  const [expired, setExpired] = useState(false);
  usePortalDirection(locale);
  const t = portalDict[locale];
  const invalid = !caseView || expired;

  // Flip the UI immediately, then persist in the background. The switch must
  // never feel like it's waiting on the network, and a failed save is not worth
  // interrupting the client over — it just means the choice doesn't outlive the
  // session, which is exactly the pre-Slice-9 behaviour.
  const onLocaleChange = (next: PortalLocale) => {
    setLocale(next);
    if (!caseView) return;
    void fetch(`/api/public/conversion/${token}/locale`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: next }),
    }).catch(() => {});
  };

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <PortalHeader locale={locale} onLocaleChange={onLocaleChange} />
      {invalid ? (
        <main className="flex flex-1 items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-2xl">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-500">
              <ShieldAlert className="h-7 w-7" />
            </div>
            <h1 className="text-xl font-bold text-slate-900">{t.invalidLinkTitle}</h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">{t.invalidLinkBody}</p>
          </div>
        </main>
      ) : (
        <>
          <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
            <ConversionPortalWizard token={token} caseView={caseView!} locale={locale} onExpired={() => setExpired(true)} />
          </main>
          <footer className="py-6 text-center text-xs text-slate-400">{t.footerNote}</footer>
        </>
      )}
    </div>
  );
}

// ─── The stepped wizard: owns journey state + the save/advance engine ───────────

function ConversionPortalWizard({
  token, caseView, locale, onExpired,
}: {
  token: string;
  caseView: PortalCaseView;
  locale: PortalLocale;
  onExpired: () => void;
}) {
  const t = portalDict[locale];
  const { client, conversionProfile, checklist } = caseView;
  const stepError = (code?: string) => (t.stepErrors as Record<string, string>)[code ?? ""] ?? t.stepErrors.GENERIC;

  // Two pointers: serverStep is DB truth (only moves on a 200 from /advance);
  // view is the on-screen slice (may trail serverStep so the client can go back
  // and review/edit earlier slices without ever desyncing the server).
  const [serverStep, setServerStep] = useState<CaseStep>(caseView.portalStep);
  const [view, setView] = useState<CaseStep>(caseView.portalStep);

  const [form, setForm] = useState<PortalForm>({
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
    personalStory: conversionProfile?.personalStory ?? "",
  });
  const set = (k: keyof PortalForm, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const [children, setChildren] = useState<ChildRow[]>(
    conversionProfile?.children.map((c) => ({ fullName: c.fullName, dateOfBirth: c.dateOfBirth?.slice(0, 10) ?? "" })) ?? []
  );
  const addChild = () => setChildren((c) => [...c, { fullName: "", dateOfBirth: "" }]);
  const removeChild = (i: number) => setChildren((c) => c.filter((_, idx) => idx !== i));
  const setChild = (i: number, k: keyof ChildRow, v: string) =>
    setChildren((c) => c.map((row, idx) => (idx === i ? { ...row, [k]: v } : row)));

  // Mirrors the server's lazy-profile semantics for the client-side pre-check:
  // true once a ConversionProfile row exists (loaded or saved this session).
  const [profileExists, setProfileExists] = useState(conversionProfile !== null);

  // Presence of a confirmed voice recording — the second way to satisfy the
  // PERSONAL_STORY guard. Only the flag matters client-side; the key itself is
  // never needed here (playback goes through a presigned URL).
  const [hasStoryAudio, setHasStoryAudio] = useState(!!conversionProfile?.storyAudioKey);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Honeypot — invisible field naive bots auto-fill; server rejects if non-empty.
  const [honeypot, setHoneypot] = useState("");

  const [items, setItems] = useState<PortalChecklistItem[]>(checklist);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingItemId = useRef<string | null>(null);

  // References persist through their own route the moment they're saved (they
  // carry server ids), so this list is the live mirror of the DB rows.
  const [references, setReferences] = useState<PortalReference[]>(conversionProfile?.references ?? []);
  const [draft, setDraft] = useState<ReferenceDraft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [refBusyId, setRefBusyId] = useState<string | null>(null);
  const [refError, setRefError] = useState<string | null>(null);

  const setDraftField = (k: keyof ReferenceDraft, v: string) =>
    setDraft((d) => (d ? { ...d, [k]: v } : d));

  const startAddReference = () => {
    setRefError(null);
    setEditingId(null);
    setDraft({ fullName: "", phone: "", role: "", relationship: "" });
  };

  const startEditReference = (r: PortalReference) => {
    setRefError(null);
    setEditingId(r.id);
    setDraft({ fullName: r.fullName, phone: r.phone, role: r.role, relationship: r.relationship ?? "" });
  };

  const cancelReference = () => {
    setRefError(null);
    setEditingId(null);
    setDraft(null);
  };

  const saveReference = async () => {
    if (!draft) return;
    setRefError(null);
    if (!draft.fullName.trim() || !draft.phone.trim() || !draft.role.trim()) {
      setRefError(t.referenceIncomplete);
      return;
    }
    setRefBusyId(editingId ?? "__new__");
    try {
      const res = await fetch(`/api/public/conversion/${token}/references`, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, ...(editingId ? { id: editingId } : {}), honeypot }),
      });
      if (res.status === 404 && !editingId) { onExpired(); return; }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRefError(data.code ? stepError(data.code) : (data.error ?? t.referenceSaveFailed));
        return;
      }
      if (editingId) {
        const edited = editingId;
        setReferences((prev) =>
          prev.map((r) => (r.id === edited ? { ...r, ...draft, relationship: draft.relationship || null } : r))
        );
      } else {
        setReferences((prev) => [...prev, data.reference as PortalReference]);
      }
      setEditingId(null);
      setDraft(null);
    } catch {
      setRefError(t.referenceSaveFailed);
    } finally {
      setRefBusyId(null);
    }
  };

  const removeReference = async (id: string) => {
    setRefError(null);
    setRefBusyId(id);
    try {
      const res = await fetch(`/api/public/conversion/${token}/references`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setRefError(data.error ?? t.referenceSaveFailed);
        return;
      }
      setReferences((prev) => prev.filter((r) => r.id !== id));
      if (editingId === id) { setEditingId(null); setDraft(null); }
    } catch {
      setRefError(t.referenceSaveFailed);
    } finally {
      setRefBusyId(null);
    }
  };

  // DB-truth projection for the client-side guard pre-check (reuses the SAME
  // canAdvance() the server runs, so validation rules live in one place).
  const buildSnapshot = (): JourneySnapshot => ({
    client: { phone: form.phone, email: form.email || null, addressCity: form.addressCity || null },
    profile: profileExists
      ? {
          communityName: form.communityName || null,
          sponsoringRabbi: form.sponsoringRabbi || null,
          personalStory: form.personalStory || null,
          storyAudioKey: hasStoryAudio ? "saved" : null,
        }
      : null,
    mandatoryChecklist: items.filter((i) => i.isMandatory).map((i) => ({ status: i.status })),
    referenceCount: references.length,
  });

  // Persist the full shared form (every slice sends everything it knows, mirroring
  // the DB — so an early slice never wipes a field a later slice owns). Wire format
  // is locale-independent; only on-screen labels are translated.
  const save = async () => {
    const res = await fetch(`/api/public/conversion/${token}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, children: children.filter((c) => c.fullName.trim()), honeypot }),
    });
    if (res.status === 404) { onExpired(); throw new Error("__expired__"); }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? t.saveErrorFallback);
    }
    setProfileExists(true);
  };

  const onContinue = async () => {
    setError(null);
    const atFrontier = view === serverStep;
    // Enforce the guard only at the live frontier; reviewing a completed slice
    // never has to re-pass it.
    if (atFrontier) {
      const pre = canAdvance(view, buildSnapshot());
      if (!pre.ok) { setError(stepError(pre.reason)); return; }
    }
    setBusy(true);
    try {
      if (DATA_SLICES.has(view)) await save();
      if (atFrontier) {
        const res = await fetch(`/api/public/conversion/${token}/advance`, { method: "POST" });
        if (res.status === 404) { onExpired(); return; }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { setError(stepError(data.code)); return; }
        setServerStep(data.step as CaseStep);
        setView(data.step as CaseStep);
      } else {
        const i = CASE_STEP_ORDER.indexOf(view);
        setView(CASE_STEP_ORDER[i + 1]);
      }
    } catch (e) {
      if (!(e instanceof Error && e.message === "__expired__")) {
        setError(e instanceof Error && e.message ? e.message : t.stepErrors.GENERIC);
      }
    } finally {
      setBusy(false);
    }
  };

  const onBack = () => {
    setError(null);
    const i = CASE_STEP_ORDER.indexOf(view);
    if (i > 0) setView(CASE_STEP_ORDER[i - 1]);
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

    if (file.size > MAX_SIZE) { setUploadError(t.fileTooLarge); pendingItemId.current = null; return; }
    if (!ALLOWED_MIME.includes(file.type)) { setUploadError(t.fileTypeInvalid); pendingItemId.current = null; return; }

    setUploadingId(checklistItemId);
    setUploadError(null);
    try {
      const presignRes = await fetch(`/api/public/conversion/${token}/presign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checklistItemId, fileName: file.name, fileSize: file.size, mimeType: file.type }),
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

  const isPassive = view === "SCHEDULE_MEETING" || view === "TRACKING";
  const canBack = CASE_STEP_ORDER.indexOf(view) > 0 && !isPassive;
  const primaryLabel =
    view === "WELCOME" ? t.navStart : view === "PROCESS_OVERVIEW" ? t.navAcknowledge : t.navContinue;

  return (
    <div>
      {/* Honeypot — off-screen; real users never see it. */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", top: "-9999px" }}>
        <label htmlFor="website">Website</label>
        <input type="text" id="website" name="website" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
      </div>
      <input ref={fileInputRef} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png" onChange={handleFileSelected} />

      {!isPassive && <WizardProgress t={t} step={view} />}

      {view === "WELCOME" && <WelcomeBody t={t} />}
      {view === "PROCESS_OVERVIEW" && <OverviewBody t={t} />}
      {view === "WIZARD_PERSONAL" && <PersonalBody t={t} client={client} form={form} set={set} />}
      {view === "WIZARD_FAMILY" && (
        <FamilyBody t={t} form={form} set={set} childRows={children} addChild={addChild} removeChild={removeChild} setChild={setChild} />
      )}
      {view === "WIZARD_BACKGROUND" && <BackgroundBody t={t} form={form} set={set} />}
      {view === "PERSONAL_STORY" && (
        <StoryBody
          t={t}
          form={form}
          set={set}
          token={token}
          hasAudio={hasStoryAudio}
          // Confirming a recording upserts the ConversionProfile row server-side,
          // so the local "profile exists" mirror must follow.
          onAudioSaved={() => { setHasStoryAudio(true); setProfileExists(true); }}
          honeypot={honeypot}
        />
      )}
      {view === "WIZARD_REFERENCES" && (
        <ReferencesBody
          t={t}
          references={references}
          draft={draft}
          setDraft={setDraftField}
          editingId={editingId}
          busyId={refBusyId}
          error={refError}
          onStartAdd={startAddReference}
          onStartEdit={startEditReference}
          onCancel={cancelReference}
          onSave={saveReference}
          onRemove={removeReference}
        />
      )}
      {view === "PENDING_DOCS" && (
        <DocumentsBody t={t} locale={locale} items={items} uploadingId={uploadingId} uploadError={uploadError} onUpload={triggerUpload} />
      )}
      {isPassive && <PassiveBody t={t} locale={locale} step={view} activities={caseView.activities} />}

      {error && <p className="mt-4 text-center text-sm font-medium text-red-600">{error}</p>}

      {/* Nav — hidden on passive (staff-driven / terminal) screens. */}
      {!isPassive && isClientAdvanceable(view) && (
        <div className="mt-6 flex items-center justify-between">
          {canBack ? (
            <button
              onClick={onBack}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-50"
            >
              <ArrowLeft className="h-4 w-4 rtl:rotate-180" /> {t.navBack}
            </button>
          ) : <span />}
          <button
            onClick={onContinue}
            disabled={busy}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy ? t.navBusy : primaryLabel}
          </button>
        </div>
      )}
    </div>
  );
}
