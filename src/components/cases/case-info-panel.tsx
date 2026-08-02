import { cn, formatDate, formatCurrency, calculateAge } from "@/lib/utils";
import { PrintLetterhead } from "@/components/print/print-letterhead";
import { PortalStepControl } from "@/components/cases/portal-step-control";
import { PersonalStoryPanel } from "@/components/cases/personal-story-panel";
import { CASE_STATUS_LABELS, CASE_TYPE_LABELS } from "@/lib/constants";
import type { CaseDetail } from "@/types";
import {
  User, Phone, Mail, MapPin, Briefcase,
  Stethoscope, Calendar, Percent, Clock, Hash,
  Users2, Building2, HeartHandshake, Scale as ScaleIcon,
} from "lucide-react";

interface RowProps {
  icon: React.ElementType;
  label: string;
  value?: string | number | null;
  valueClassName?: string;
}

function Row({ icon: Icon, label, value, valueClassName }: RowProps) {
  if (!value && value !== 0) return null;
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
        <p className={cn("text-sm font-medium text-slate-800 leading-snug", valueClassName)}>
          {value}
        </p>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-400">{title}</h3>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

const GENDER_LABELS = { MALE: "זכר", FEMALE: "נקבה", OTHER: "אחר" };
const EMPLOYMENT_LABELS: Record<string, string> = {
  EMPLOYED: "שכיר", SELF_EMPLOYED: "עצמאי", UNEMPLOYED: "מובטל",
  RETIRED: "פנסיונר", STUDENT: "סטודנט", UNABLE_TO_WORK: "לא מסוגל לעבוד",
};

interface CaseInfoPanelProps {
  caseDetail: CaseDetail;
}

export function CaseInfoPanel({ caseDetail }: CaseInfoPanelProps) {
  const { client } = caseDetail;
  const age = calculateAge(client.dateOfBirth);

  return (
    <div className="flex flex-col gap-6 p-5">
      <PrintLetterhead
        subtitle={`תיק ${caseDetail.caseNumber} — ${CASE_TYPE_LABELS[caseDetail.caseType]}`}
        meta={`סטטוס: ${CASE_STATUS_LABELS[caseDetail.status]}`}
      />

      {/* Client personal */}
      <Section title="פרטים אישיים">
        <Row icon={User} label="שם מלא" value={client.fullName} />
        <Row icon={Hash} label="תעודת זהות" value={client.nationalId} valueClassName="font-mono" />
        <Row icon={Calendar} label="תאריך לידה"
          value={`${formatDate(client.dateOfBirth)} (גיל ${age})`} />
        <Row icon={User} label="מגדר" value={GENDER_LABELS[client.gender]} />
        <Row icon={Phone} label="טלפון" value={client.phone} />
        <Row icon={Mail} label="אימייל" value={client.email} />
        <Row icon={MapPin} label="כתובת"
          value={client.addressStreet ? `${client.addressStreet}, ${client.addressCity}` : client.addressCity} />
      </Section>

      <div className="border-t border-slate-100" />

      {/* Employment */}
      <Section title="תעסוקה והכנסה">
        <Row icon={Briefcase} label="מעמד תעסוקתי"
          value={EMPLOYMENT_LABELS[client.employmentStatus]} />
        <Row icon={Briefcase} label="מעסיק" value={client.employer} />
        {client.monthlyIncome !== undefined && client.monthlyIncome !== null && (
          <Row icon={Briefcase} label="הכנסה חודשית"
            value={formatCurrency(Number(client.monthlyIncome))} />
        )}
        {client.spouseName && (
          <Row icon={User} label="בן/בת זוג" value={client.spouseName} />
        )}
        {client.spouseIncome !== undefined && client.spouseIncome !== null && (
          <Row icon={Briefcase} label="הכנסת בן/בת זוג"
            value={formatCurrency(Number(client.spouseIncome))} />
        )}
      </Section>

      <div className="border-t border-slate-100" />

      {/* Medical */}
      <Section title="רקע רפואי">
        <Row icon={Stethoscope} label="מצב עיקרי" value={client.primaryCondition} />
        {client.icdCode && (
          <Row icon={Hash} label="קוד ICD" value={client.icdCode} valueClassName="font-mono" />
        )}
        {client.recognizedPercentage !== undefined && (
          <Row icon={Percent} label="אחוז מוכר קיים"
            value={`${client.recognizedPercentage}%`}
            valueClassName="text-emerald-700 font-bold" />
        )}
        {caseDetail.claimedPercentage !== undefined && (
          <Row icon={Percent} label="אחוז מבוקש"
            value={`${caseDetail.claimedPercentage}%`}
            valueClassName="text-indigo-700 font-bold" />
        )}
        {client.diagnosisDate && (
          <Row icon={Calendar} label="תאריך אבחנה" value={formatDate(client.diagnosisDate)} />
        )}
        <Row icon={Stethoscope} label="רופא מטפל" value={client.treatingPhysician} />
      </Section>

      {/* Journey control renders for every conversion case — the profile row is
          created lazily on the client's first portal submit, but the journey
          (and the staff's ability to move/reset it) starts at case creation. */}
      {caseDetail.caseType === "CONVERSION" && (
        <>
          <div className="border-t border-slate-100" />
          <Section title="מסע הלקוח בפורטל">
            <PortalStepControl caseId={caseDetail.id} step={caseDetail.portalStep} />
          </Section>
        </>
      )}

      {caseDetail.caseType === "CONVERSION" && caseDetail.conversionProfile && (
        <>
          <div className="border-t border-slate-100" />
          <Section title="פרטי גיור">
            <Row icon={Users2} label="בן/בת זוג" value={caseDetail.conversionProfile.spouseFullName} />
            <Row icon={Hash} label="ת.ז. בן/בת זוג" value={caseDetail.conversionProfile.spouseNationalId} valueClassName="font-mono" />
            <Row icon={Building2} label="קהילה" value={caseDetail.conversionProfile.communityName} />
            <Row icon={HeartHandshake} label="רב מלווה" value={caseDetail.conversionProfile.sponsoringRabbi} />
            <Row icon={ScaleIcon} label="בית דין" value={caseDetail.conversionProfile.courtName} />
            {caseDetail.conversionProfile.children.length > 0 && (
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">ילדים</p>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {caseDetail.conversionProfile.children.map((child) => (
                    <li key={child.id} className="text-sm font-medium text-slate-800">
                      {child.fullName}
                      {child.dateOfBirth && <span className="text-slate-400"> · {formatDate(child.dateOfBirth)}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {caseDetail.conversionProfile.references.length > 0 && (
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">ממליצים</p>
                <ul className="mt-1 flex flex-col gap-1.5">
                  {caseDetail.conversionProfile.references.map((ref) => (
                    <li key={ref.id}>
                      <p className="text-sm font-medium text-slate-800">
                        {ref.fullName}
                        <span className="text-slate-400"> · {ref.role}</span>
                      </p>
                      <p className="text-xs text-slate-500">
                        <a href={`tel:${ref.phone}`} className="hover:underline" dir="ltr">{ref.phone}</a>
                        {ref.relationship && <span className="text-slate-400"> · {ref.relationship}</span>}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <PersonalStoryPanel
              caseId={caseDetail.id}
              personalStory={caseDetail.conversionProfile.personalStory}
              hasAudio={!!caseDetail.conversionProfile.storyAudioKey}
              transcript={caseDetail.conversionProfile.storyTranscript}
              transcriptionStatus={caseDetail.conversionProfile.storyTranscriptionStatus}
            />
            {caseDetail.conversionProfile.submittedAt && (
              <Row icon={Clock} label="עודכן על ידי הלקוח" value={formatDate(caseDetail.conversionProfile.submittedAt)} />
            )}
          </Section>
        </>
      )}

      <div className="border-t border-slate-100" />

      {/* Case meta */}
      <Section title="פרטי תיק">
        <Row icon={Clock} label="נפתח ב" value={formatDate(caseDetail.createdAt)} />
        <Row icon={Calendar} label="עדכון אחרון" value={formatDate(caseDetail.updatedAt)} />
        <Row icon={Calendar} label="מועד הגשה"
          value={caseDetail.submissionDeadline ? formatDate(caseDetail.submissionDeadline) : null}
          valueClassName="text-amber-700 font-semibold" />
        <Row icon={Calendar} label="מעקב הבא"
          value={caseDetail.nextFollowUpDate ? formatDate(caseDetail.nextFollowUpDate) : null} />
        {caseDetail.claimDescription && (
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">
              תיאור התביעה
            </p>
            <p className="text-xs leading-relaxed text-slate-600">{caseDetail.claimDescription}</p>
          </div>
        )}
      </Section>
    </div>
  );
}
