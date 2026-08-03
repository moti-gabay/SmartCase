"use client";

import { useEffect, useRef, useState } from "react";
import { cn, formatDate, calculateAge } from "@/lib/utils";
import {
  portalDict, translateChecklistLabel, translateChecklistDescription, type PortalLocale,
} from "@/lib/i18n/conversion-portal";
import type { PortalCaseView, PortalChecklistItem, PortalActivityEntry, PortalActivityType, PortalReference } from "@/lib/queries";
import type { CaseStep } from "@/types";
import { CASE_STEP_ORDER, MIN_REFERENCES } from "@/lib/portal/journey";
import {
  BookOpen, ClipboardList, HeartHandshake, Users2, User, Phone, Mail, MapPin,
  Plus, X, Upload, CheckCircle2, AlertTriangle, Loader2, CreditCard, FileBadge,
  Building2, Camera, FileText, ScrollText, ListChecks, CalendarClock, Sparkles, UserCheck,
  Mic, Square, Play,
} from "lucide-react";

// ── Shared form shape (owned by the orchestrator, threaded into each screen) ──
export interface PortalForm {
  phone: string;
  email: string;
  addressCity: string;
  spouseFullName: string;
  spouseNationalId: string;
  spouseReligion: string;
  communityName: string;
  sponsoringRabbi: string;
  courtName: string;
  additionalNotes: string;
  personalStory: string;
}
export interface ChildRow {
  fullName: string;
  dateOfBirth: string;
}
type Dict = (typeof portalDict)["he"];
type Setter = (k: keyof PortalForm, v: string) => void;

// ── Shared styles (kept identical to the original portal form) ──
export const inputCls =
  "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100";
const labelCls = "mb-1 block text-xs font-medium text-slate-600";
const card = "rounded-2xl border border-slate-200 bg-white p-6 shadow-sm";
const heading = "mb-1 flex items-center gap-2 text-base font-bold text-slate-900";
const introCls = "mb-5 text-sm text-slate-500";

const DOC_ICONS: Record<string, React.ElementType> = {
  NATIONAL_ID: CreditCard,
  RABBI_LETTER: FileBadge,
  COMMUNITY_LETTER: Building2,
  FAMILY_PHOTO: Camera,
};

// ── Progress rail: only the client-facing steps (WELCOME → PENDING_DOCS) ──
const CLIENT_STEPS = CASE_STEP_ORDER.slice(0, CASE_STEP_ORDER.indexOf("PENDING_DOCS") + 1);

export function WizardProgress({ t, step }: { t: Dict; step: CaseStep }) {
  const idx = CLIENT_STEPS.indexOf(step);
  // Staff-driven / terminal steps sit past the client rail — peg the bar full.
  const activeIdx = idx === -1 ? CLIENT_STEPS.length - 1 : idx;
  const pct = Math.round(((activeIdx + 1) / CLIENT_STEPS.length) * 100);
  return (
    <div className="mb-6">
      <div className="mb-2 flex items-center justify-between text-xs font-medium text-slate-500">
        <span>{t.progressLabel} {activeIdx + 1}/{CLIENT_STEPS.length}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
        <div className="h-full rounded-full bg-indigo-600 transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ── Screen 1: WELCOME ──
export function WelcomeBody({ t }: { t: Dict }) {
  return (
    <div className={cn(card, "bg-gradient-to-br from-indigo-50 to-white text-center")}>
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 text-white">
        <Sparkles className="h-7 w-7" />
      </div>
      <h1 className="text-xl font-bold text-slate-900">{t.welcomeHeroTitle}</h1>
      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-slate-600">{t.welcomeHeroBody}</p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
        {[
          { icon: ClipboardList, text: t.step1 },
          { icon: HeartHandshake, text: t.step2 },
          { icon: CheckCircle2, text: t.step3 },
        ].map(({ icon: Icon, text }) => (
          <div key={text} className="flex items-center gap-2 rounded-lg bg-white/70 px-3 py-2 text-xs font-medium text-indigo-800">
            <Icon className="h-4 w-4 shrink-0" /> {text}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Screen 2: PROCESS_OVERVIEW ──
export function OverviewBody({ t }: { t: Dict }) {
  return (
    <div className={card}>
      <h1 className={heading}><BookOpen className="h-5 w-5 text-indigo-500" /> {t.overviewTitle}</h1>
      <p className={introCls}>{t.overviewSubtitle}</p>
      <ol className="relative flex flex-col gap-5 ps-8">
        <span className="absolute inset-y-2 start-[13px] w-px bg-slate-200" aria-hidden="true" />
        {t.overviewPhases.map((phase, i) => (
          <li key={i} className="relative">
            <span className="absolute -start-8 flex h-7 w-7 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700 ring-4 ring-white">
              {i + 1}
            </span>
            <p className="text-sm font-semibold text-slate-800">{phase.title}</p>
            <p className="text-xs text-slate-500">{phase.subtitle}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ── Screen 3: WIZARD_PERSONAL ──
export function PersonalBody({ t, client, form, set }: {
  t: Dict; client: PortalCaseView["client"]; form: PortalForm; set: Setter;
}) {
  const age = calculateAge(client.dateOfBirth);
  return (
    <div className={card}>
      <h1 className={heading}><User className="h-5 w-5 text-indigo-500" /> {t.personalTitle}</h1>
      <p className={introCls}>{t.personalIntro}</p>
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
  );
}

// ── Screen 4: WIZARD_FAMILY ──
export function FamilyBody({ t, form, set, childRows, addChild, removeChild, setChild }: {
  t: Dict; form: PortalForm; set: Setter;
  childRows: ChildRow[];
  addChild: () => void;
  removeChild: (i: number) => void;
  setChild: (i: number, k: keyof ChildRow, v: string) => void;
}) {
  return (
    <div className={card}>
      <h1 className={heading}><Users2 className="h-5 w-5 text-indigo-500" /> {t.familyTitle}</h1>
      <p className={introCls}>{t.familyIntro}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div><label className={labelCls}>{t.spouseFullName}</label><input className={inputCls} value={form.spouseFullName} onChange={(e) => set("spouseFullName", e.target.value)} /></div>
        <div><label className={labelCls}>{t.spouseNationalId}</label><input className={inputCls} value={form.spouseNationalId} onChange={(e) => set("spouseNationalId", e.target.value)} /></div>
        <div><label className={labelCls}>{t.spouseReligion}</label><input className={inputCls} value={form.spouseReligion} onChange={(e) => set("spouseReligion", e.target.value)} /></div>
      </div>
      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <label className={labelCls}>{t.childrenLabel}</label>
          <button type="button" onClick={addChild} className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline">
            <Plus className="h-3.5 w-3.5" /> {t.addChild}
          </button>
        </div>
        {childRows.length === 0 && <p className="text-xs text-slate-400">{t.noChildren}</p>}
        <div className="flex flex-col gap-2">
          {childRows.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <input className={inputCls} placeholder={t.childNamePlaceholder} value={c.fullName} onChange={(e) => setChild(i, "fullName", e.target.value)} />
              <input type="date" className={cn(inputCls, "max-w-[160px]")} value={c.dateOfBirth} onChange={(e) => setChild(i, "dateOfBirth", e.target.value)} />
              <button type="button" onClick={() => removeChild(i)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500">
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Screen 5: WIZARD_BACKGROUND ──
export function BackgroundBody({ t, form, set }: { t: Dict; form: PortalForm; set: Setter }) {
  return (
    <div className={card}>
      <h1 className={heading}><Building2 className="h-5 w-5 text-indigo-500" /> {t.backgroundIntro}</h1>
      <p className={introCls}>{t.familyTitle}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div><label className={labelCls}>{t.communityName}</label><input className={inputCls} value={form.communityName} onChange={(e) => set("communityName", e.target.value)} /></div>
        <div><label className={labelCls}>{t.sponsoringRabbi}</label><input className={inputCls} value={form.sponsoringRabbi} onChange={(e) => set("sponsoringRabbi", e.target.value)} /></div>
        <div><label className={labelCls}>{t.courtName}</label><input className={inputCls} value={form.courtName} onChange={(e) => set("courtName", e.target.value)} /></div>
      </div>
      <div className="mt-3">
        <label className={labelCls}>{t.additionalNotes}</label>
        <textarea
          className="min-h-[80px] w-full rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          value={form.additionalNotes}
          onChange={(e) => set("additionalNotes", e.target.value)}
        />
      </div>
    </div>
  );
}

// ── Screen 6: PERSONAL_STORY ──
// Two equivalent ways to tell the story: the textarea (always available — the
// fallback whenever recording is unsupported or the mic is denied) and a voice
// recording. Either one alone satisfies the server guard.
export function StoryBody({
  t, form, set, token, hasAudio, onAudioSaved, honeypot,
}: {
  t: Dict; form: PortalForm; set: Setter;
  token: string;
  hasAudio: boolean;
  onAudioSaved: () => void;
  honeypot: string;
}) {
  return (
    <div className={card}>
      <h1 className={heading}><ScrollText className="h-5 w-5 text-indigo-500" /> {t.storyTitle}</h1>
      <p className={introCls}>{t.storyIntro}</p>
      <textarea
        className="min-h-[220px] w-full rounded-lg border border-slate-200 bg-white p-4 text-sm leading-relaxed text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
        placeholder={t.storyPlaceholder}
        value={form.personalStory}
        onChange={(e) => set("personalStory", e.target.value)}
      />
      <StoryRecorder t={t} token={token} hasAudio={hasAudio} onAudioSaved={onAudioSaved} honeypot={honeypot} />
    </div>
  );
}

// MediaRecorder capture → presigned PUT to R2 → confirm. The blob never touches
// a Next.js route (only its metadata does), matching the document pipeline.
// Local playback uses the in-memory blob; a recording from a previous session is
// played through a short-lived presigned GET fetched on demand.
function StoryRecorder({
  t, token, hasAudio, onAudioSaved, honeypot,
}: {
  t: Dict; token: string; hasAudio: boolean; onAudioSaved: () => void; honeypot: string;
}) {
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(hasAudio);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  // Object URLs created for local playback are revoked on unmount / replacement.
  const localUrlRef = useRef<string | null>(null);
  useEffect(() => () => { if (localUrlRef.current) URL.revokeObjectURL(localUrlRef.current); }, []);

  const supported =
    typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  const upload = async (blob: Blob) => {
    setSaving(true);
    setError(null);
    try {
      const mimeType = blob.type || "audio/webm";
      const ext = mimeType.includes("mp4") ? "m4a" : mimeType.includes("ogg") ? "ogg" : "webm";
      const presignRes = await fetch(`/api/public/conversion/${token}/story/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: `story.${ext}`, fileSize: blob.size, mimeType, honeypot }),
      });
      if (!presignRes.ok) throw new Error();
      const { storageKey, upload: put } = await presignRes.json();

      const putRes = await fetch(put.url, { method: "PUT", body: blob, headers: { "Content-Type": mimeType } });
      if (!putRes.ok) throw new Error();

      const confirmRes = await fetch(`/api/public/conversion/${token}/story/upload`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storageKey, honeypot }),
      });
      if (!confirmRes.ok) throw new Error();

      setSaved(true);
      onAudioSaved();
    } catch {
      setError(t.storyRecordFailed);
    } finally {
      setSaving(false);
    }
  };

  const start = async () => {
    setError(null);
    if (!supported) { setError(t.storyRecordUnsupported); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        // Release the mic as soon as capture ends — the tab must not keep the
        // recording indicator on while the upload runs.
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (localUrlRef.current) URL.revokeObjectURL(localUrlRef.current);
        localUrlRef.current = URL.createObjectURL(blob);
        setPlaybackUrl(localUrlRef.current);
        void upload(blob);
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch {
      setError(t.storyRecordDenied);
    }
  };

  const stop = () => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  };

  // Recording from an earlier session: fetch a fresh presigned playback URL.
  const loadSaved = async () => {
    setError(null);
    try {
      const res = await fetch(`/api/public/conversion/${token}/story/upload`);
      if (!res.ok) throw new Error();
      const { url } = await res.json();
      setPlaybackUrl(url);
    } catch {
      setError(t.storyRecordFailed);
    }
  };

  return (
    <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <p className="text-sm font-semibold text-slate-800">{t.storyRecordTitle}</p>
      <p className="mt-0.5 text-xs text-slate-500">{t.storyRecordIntro}</p>

      {error && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {error}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {recording ? (
          <button
            type="button"
            onClick={stop}
            className="flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700"
          >
            <Square className="h-3.5 w-3.5" /> {t.storyRecordStop}
          </button>
        ) : (
          <button
            type="button"
            onClick={start}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            <Mic className="h-3.5 w-3.5" /> {saved ? t.storyRecordAgain : t.storyRecordStart}
          </button>
        )}

        {recording && (
          <span className="flex items-center gap-1.5 text-xs font-medium text-red-600">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-600" /> REC
          </span>
        )}
        {saving && (
          <span className="flex items-center gap-1.5 text-xs text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t.storyRecordSaving}
          </span>
        )}
        {saved && !saving && !recording && (
          <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600">
            <CheckCircle2 className="h-3.5 w-3.5" /> {t.storyRecordSaved}
          </span>
        )}
        {saved && !playbackUrl && !recording && !saving && (
          <button type="button" onClick={loadSaved} className="text-xs font-medium text-indigo-600 hover:underline">
            <Play className="me-1 inline h-3.5 w-3.5" />{t.storyRecordSaved}
          </button>
        )}
      </div>

      {playbackUrl && <audio className="mt-3 w-full" controls src={playbackUrl} />}
    </div>
  );
}

// ── Screen 7: WIZARD_REFERENCES ──
// Rows persist immediately through /references (they carry server ids), unlike
// the other slices which batch into /submit on Continue.
export interface ReferenceDraft {
  fullName: string;
  phone: string;
  role: string;
  relationship: string;
}

export function ReferencesBody({
  t, references, draft, setDraft, editingId, busyId, error,
  onStartAdd, onStartEdit, onCancel, onSave, onRemove,
}: {
  t: Dict;
  references: PortalReference[];
  draft: ReferenceDraft | null;
  setDraft: (k: keyof ReferenceDraft, v: string) => void;
  editingId: string | null;
  busyId: string | null;
  error: string | null;
  onStartAdd: () => void;
  onStartEdit: (r: PortalReference) => void;
  onCancel: () => void;
  onSave: () => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className={card}>
      <h1 className={heading}><UserCheck className="h-5 w-5 text-indigo-500" /> {t.referencesTitle}</h1>
      <p className={introCls}>{t.referencesIntro}</p>

      {error && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      <div className="mb-4 flex flex-col gap-2.5">
        {references.length === 0 && !draft && <p className="text-xs text-slate-400">{t.noReferences}</p>}
        {references.map((r) => (
          <div key={r.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-100 bg-white shadow-sm">
              <UserCheck className="h-4 w-4 text-slate-500" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-800">{r.fullName}</p>
              <p className="text-xs text-slate-500">{r.role} · {r.phone}</p>
              {r.relationship && <p className="mt-0.5 text-xs text-slate-400">{r.relationship}</p>}
            </div>
            <button
              type="button"
              onClick={() => onStartEdit(r)}
              disabled={busyId !== null}
              className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"
            >
              {t.editReference}
            </button>
            <button
              type="button"
              onClick={() => onRemove(r.id)}
              disabled={busyId !== null}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
              aria-label={t.removeReference}
            >
              {busyId === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
            </button>
          </div>
        ))}
      </div>

      {draft ? (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className={labelCls}>{t.referenceName}</label>
              <input className={inputCls} value={draft.fullName} onChange={(e) => setDraft("fullName", e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>{t.referencePhone}</label>
              <input className={inputCls} value={draft.phone} onChange={(e) => setDraft("phone", e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>{t.referenceRole}</label>
              <input
                className={inputCls}
                placeholder={t.referenceRolePlaceholder}
                value={draft.role}
                onChange={(e) => setDraft("role", e.target.value)}
              />
            </div>
          </div>
          <div className="mt-3">
            <label className={labelCls}>{t.referenceRelationship}</label>
            <input
              className={inputCls}
              placeholder={t.referenceRelationshipPlaceholder}
              value={draft.relationship}
              onChange={(e) => setDraft("relationship", e.target.value)}
            />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={onSave}
              disabled={busyId !== null}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {busyId === (editingId ?? "__new__") && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t.saveReference}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={busyId !== null}
              className="rounded-lg px-3 py-2 text-xs font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-50"
            >
              {t.cancelReference}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={onStartAdd}
          className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline"
        >
          <Plus className="h-3.5 w-3.5" /> {t.addReference}
        </button>
      )}

      <p className="mt-4 text-xs text-slate-400">
        {references.length}/{MIN_REFERENCES} {t.referencesCount}
      </p>
    </div>
  );
}

// ── Screen 8: PENDING_DOCS ──
export function DocumentsBody({ t, locale, items, uploadingId, uploadError, onUpload }: {
  t: Dict; locale: PortalLocale; items: PortalChecklistItem[];
  uploadingId: string | null; uploadError: string | null;
  onUpload: (itemId: string) => void;
}) {
  return (
    <div className={card}>
      <h1 className={heading}><ListChecks className="h-5 w-5 text-indigo-500" /> {t.documentsTitle}</h1>
      <p className={introCls}>{t.docsIntro} · <span className="text-slate-400">{t.documentsHint}</span></p>

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
          const description = translateChecklistDescription(locale, item.documentType, item.description);
          return (
            <div key={item.id} className={cn("flex items-center gap-3 rounded-xl border p-3.5", isDone ? "border-emerald-100 bg-emerald-50/40" : "border-slate-200 bg-white")}>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-100 bg-white shadow-sm">
                <Icon className="h-4.5 w-4.5 text-slate-500" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-800">{label}</span>
                  {item.isMandatory
                    ? <span className="rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-500">{t.mandatory}</span>
                    : <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-400">{t.optional}</span>}
                </div>
                {description && <p className="mt-0.5 text-xs leading-relaxed text-slate-400">{description}</p>}
                {item.status === "REJECTED" && item.reviewNotes && (
                  <p className="mt-1 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700">
                    {t.docRejectedReason} {item.reviewNotes}
                  </p>
                )}
              </div>
              <button
                onClick={() => onUpload(item.id)}
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
  );
}

// ── Public, presentation-only progress tracker ──
// Renders purely from the masked activity type + timestamp (no staff identity,
// no descriptions). Every label is localized off the enum, never DB text.
const ACTIVITY_DOT: Record<PortalActivityType, string> = {
  DOCUMENT_APPROVED: "bg-emerald-500",
  DOCUMENT_REJECTED: "bg-amber-500",
  STEP_CHANGED:      "bg-indigo-500",
};

function PublicTimeline({ t, locale, activities }: {
  t: Dict; locale: PortalLocale; activities: PortalActivityEntry[];
}) {
  const label: Record<PortalActivityType, string> = {
    DOCUMENT_APPROVED: t.activityDocApproved,
    DOCUMENT_REJECTED: t.activityDocRejected,
    STEP_CHANGED:      t.activityStepChanged,
  };
  return (
    <div className={cn(card, "mt-4")}>
      <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-slate-800">
        <ListChecks className="h-4 w-4 text-indigo-500" /> {t.timelineTitle}
      </h2>
      {activities.length === 0 ? (
        <p className="text-sm text-slate-400">{t.timelineEmpty}</p>
      ) : (
        <ol className="relative flex flex-col gap-4 border-s border-slate-200 ps-4">
          {activities.map((a) => (
            <li key={a.id} className="relative">
              <span className={cn("absolute -start-[21px] top-1 h-2.5 w-2.5 rounded-full ring-2 ring-white", ACTIVITY_DOT[a.type])} />
              <p className="text-sm font-medium text-slate-800">{label[a.type]}</p>
              <p className="text-xs text-slate-400">{new Date(a.createdAt).toLocaleDateString(locale)}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ── Screen 9: SCHEDULE_MEETING ──
//
// The client picks from real office availability. The list is fetched (never
// passed down from the page) because slots go stale the moment another client
// books one, and it is re-fetched after every attempt so a 409 immediately shows
// an accurate list rather than the one that just lost the race.

export interface PortalSlot {
  id: string;
  startsAt: string;
  durationMinutes: number;
  location: string | null;
}

// Locale-aware, and explicitly NOT hand-formatted: Hebrew, English and French
// each want a different day/month order, and Intl already knows all three.
function formatSlotWhen(iso: string, locale: PortalLocale): string {
  return new Date(iso).toLocaleString(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SchedulingBody({ t, locale, token, honeypot, initialAvailable, initialBooked, onBooked }: {
  t: Dict;
  locale: PortalLocale;
  token: string;
  honeypot: string;
  initialAvailable: PortalSlot[];
  initialBooked: PortalSlot | null;
  onBooked: (booked: PortalSlot | null) => void;
}) {
  // Seeded from the server render, so this screen paints with real availability
  // and never needs a fetch-on-mount effect. It re-syncs from /slots after every
  // booking attempt — the only moment the list can have gone stale under us.
  const [available, setAvailable] = useState<PortalSlot[]>(initialAvailable);
  const [booked, setBooked] = useState<PortalSlot | null>(initialBooked);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Set once the client asks to change an already-booked time, so the list
  // reappears without losing the booking until a new one actually succeeds.
  const [changing, setChanging] = useState(false);

  const refresh = async () => {
    try {
      const res = await fetch(`/api/public/conversion/${token}/slots`);
      if (!res.ok) return;
      const data = await res.json();
      setAvailable(data.available ?? []);
      setBooked(data.booked ?? null);
      onBooked(data.booked ?? null);
    } catch {
      // A failed refresh leaves the last known list on screen; the booking
      // itself already succeeded or failed on its own terms.
    }
  };

  const book = async (slotId: string) => {
    setError(null);
    setBusyId(slotId);
    try {
      const res = await fetch(`/api/public/conversion/${token}/book`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotId, honeypot }),
      });
      if (res.status === 409) {
        setError(t.scheduleTaken);
        await refresh(); // the list that lost the race is worthless — replace it
        return;
      }
      if (!res.ok) {
        setError(t.scheduleFailed);
        return;
      }
      const data = await res.json();
      setBooked(data.booked);
      onBooked(data.booked);
      setChanging(false);
      await refresh();
    } catch {
      setError(t.scheduleFailed);
    } finally {
      setBusyId(null);
    }
  };

  const showList = !booked || changing;

  return (
    <div className={card}>
      <h1 className={heading}><CalendarClock className="h-5 w-5 text-indigo-500" /> {t.scheduleTitle}</h1>
      <p className={introCls}>{t.scheduleBody}</p>

      {booked && (
        <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="mb-1 flex items-center gap-2 text-xs font-semibold text-emerald-700">
            <CheckCircle2 className="h-4 w-4" /> {t.scheduleBooked}
          </p>
          <p className="text-sm font-medium text-slate-900">{formatSlotWhen(booked.startsAt, locale)}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {booked.durationMinutes} {t.scheduleMinutes}
            {booked.location ? ` · ${booked.location}` : ""}
          </p>
          {!changing && (
            <button
              onClick={() => setChanging(true)}
              className="mt-3 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
            >
              {t.scheduleChange}
            </button>
          )}
        </div>
      )}

      {showList && available.length === 0 && (
        <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">{t.scheduleEmpty}</p>
      )}

      {showList && available.length > 0 && (
        <ul className="space-y-2">
          {available.map((slot) => (
            <li key={slot.id}>
              <button
                onClick={() => book(slot.id)}
                disabled={busyId !== null}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 text-start hover:border-indigo-300 hover:bg-indigo-50 disabled:opacity-60"
              >
                <span>
                  <span className="block text-sm font-medium text-slate-900">{formatSlotWhen(slot.startsAt, locale)}</span>
                  <span className="block text-xs text-slate-500">
                    {slot.durationMinutes} {t.scheduleMinutes}
                    {slot.location ? ` · ${slot.location}` : ""}
                  </span>
                </span>
                <span className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600">
                  {busyId === slot.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {t.scheduleConfirm}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="mt-4 text-sm font-medium text-red-600">{error}</p>}
    </div>
  );
}

// ── TRACKING: passive terminal view ──
export function PassiveBody({ t, locale, step, activities }: {
  t: Dict; locale: PortalLocale; step: CaseStep; activities: PortalActivityEntry[];
}) {
  const tracking = step === "TRACKING";
  return (
    <>
      <div className={cn(card, "text-center")}>
        <div className={cn("mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl", tracking ? "bg-emerald-50 text-emerald-500" : "bg-indigo-50 text-indigo-500")}>
          <CalendarClock className="h-7 w-7" />
        </div>
        <h1 className="text-lg font-bold text-slate-900">{tracking ? t.trackingTitle : t.awaitingTitle}</h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-500">{tracking ? t.trackingBody : t.awaitingBody}</p>
      </div>
      <PublicTimeline t={t} locale={locale} activities={activities} />
    </>
  );
}
