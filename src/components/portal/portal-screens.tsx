"use client";

import { cn, formatDate } from "@/lib/utils";
import {
  portalDict, translateChecklistLabel, translateChecklistDescription, type PortalLocale,
} from "@/lib/i18n/conversion-portal";
import type { PortalCaseView, PortalChecklistItem } from "@/lib/queries";
import type { CaseStep } from "@/types";
import { CASE_STEP_ORDER } from "@/lib/portal/journey";
import {
  BookOpen, ClipboardList, HeartHandshake, Users2, User, Phone, Mail, MapPin,
  Plus, X, Upload, CheckCircle2, AlertTriangle, Loader2, CreditCard, FileBadge,
  Building2, Camera, FileText, ScrollText, ListChecks, CalendarClock, Sparkles,
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
  const age = Math.floor((Date.now() - new Date(client.dateOfBirth).getTime()) / (1000 * 60 * 60 * 24 * 365.25));
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
export function FamilyBody({ t, form, set, children, addChild, removeChild, setChild }: {
  t: Dict; form: PortalForm; set: Setter;
  children: ChildRow[];
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
        {children.length === 0 && <p className="text-xs text-slate-400">{t.noChildren}</p>}
        <div className="flex flex-col gap-2">
          {children.map((c, i) => (
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
export function StoryBody({ t, form, set }: { t: Dict; form: PortalForm; set: Setter }) {
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
    </div>
  );
}

// ── Screen 7: PENDING_DOCS ──
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

// ── SCHEDULE_MEETING / TRACKING: passive holding views (staff-driven / terminal) ──
export function PassiveBody({ t, step }: { t: Dict; step: CaseStep }) {
  const tracking = step === "TRACKING";
  return (
    <div className={cn(card, "text-center")}>
      <div className={cn("mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl", tracking ? "bg-emerald-50 text-emerald-500" : "bg-indigo-50 text-indigo-500")}>
        <CalendarClock className="h-7 w-7" />
      </div>
      <h1 className="text-lg font-bold text-slate-900">{tracking ? t.trackingTitle : t.awaitingTitle}</h1>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-500">{tracking ? t.trackingBody : t.awaitingBody}</p>
    </div>
  );
}
