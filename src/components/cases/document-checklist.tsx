"use client";

import { useState, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn, formatDate } from "@/lib/utils";
import { DocStatusBadge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { deleteDocument, reviewDocument } from "@/lib/actions";
import { DOCUMENT_TYPE_LABELS } from "@/lib/constants";
import type { ChecklistItemDetail, CaseDocument, DocumentStatus } from "@/types";
import {
  CheckCircle2, XCircle, Clock, AlertTriangle, RefreshCw,
  Upload, Eye, Sparkles, ChevronDown, ChevronUp,
  FileText, CreditCard, Stethoscope, Banknote, Building2,
  Camera, Award, FileBadge, ShieldCheck, Info,
  Download, Trash2, Plus, X, Loader2,
} from "lucide-react";

// ─── Icon per document type ───────────────────────────────────────────────────

const DOC_ICONS: Record<string, React.ElementType> = {
  NATIONAL_ID:             CreditCard,
  MEDICAL_REPORT:          Stethoscope,
  PSYCHIATRIC_EVALUATION:  FileBadge,
  SALARY_SLIP:             Banknote,
  EMPLOYER_CONFIRMATION:   Building2,
  BANK_STATEMENT:          Building2,
  HOSPITALIZATION_SUMMARY: Stethoscope,
  SPECIALIST_REFERRAL:     Stethoscope,
  PRESCRIPTION:            FileText,
  LAB_RESULTS:             FileText,
  INCOME_TAX_RETURN:       FileText,
  SPOUSE_INCOME_PROOF:     Banknote,
  DISABILITY_CERTIFICATE:  Award,
  PHOTOGRAPH:              Camera,
  AUTHORITY_DECISION_LETTER: ShieldCheck,
  APPEAL_LETTER:           FileText,
  POWER_OF_ATTORNEY:       FileText,
  RABBI_LETTER:            FileBadge,
  COMMUNITY_LETTER:        Building2,
  FAMILY_PHOTO:            Camera,
  OTHER:                   FileText,
};

// ─── Status icon ─────────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: DocumentStatus }) {
  const props = { className: "h-5 w-5 shrink-0" };
  switch (status) {
    case "APPROVED":                return <CheckCircle2 {...props} className={cn(props.className, "text-emerald-500")} />;
    case "REJECTED":                return <XCircle      {...props} className={cn(props.className, "text-red-500")} />;
    case "UPLOADED_PENDING_REVIEW": return <Clock        {...props} className={cn(props.className, "text-amber-500")} />;
    case "EXPIRED":                 return <RefreshCw    {...props} className={cn(props.className, "text-slate-400")} />;
    case "PENDING_UPLOAD":          return <Clock        {...props} className={cn(props.className, "text-slate-400")} />;
    case "MISSING":                 return <AlertTriangle {...props} className={cn(props.className, "text-red-400")} />;
  }
}

// ─── Row border per status ────────────────────────────────────────────────────

const ROW_STYLE: Record<DocumentStatus, string> = {
  MISSING:                 "border-red-100 bg-red-50/40",
  PENDING_UPLOAD:          "border-slate-100 bg-slate-50/40",
  UPLOADED_PENDING_REVIEW: "border-amber-100 bg-amber-50/30",
  APPROVED:                "border-emerald-100 bg-emerald-50/20",
  REJECTED:                "border-red-200 bg-red-50/60",
  EXPIRED:                 "border-slate-200 bg-slate-50/40",
};

// ─── File size formatter ──────────────────────────────────────────────────────

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── AI Validation Panel ──────────────────────────────────────────────────────

function AiValidationPanel({ validation }: {
  validation: NonNullable<ChecklistItemDetail["document"]>["aiValidation"];
}) {
  if (!validation) return null;
  return (
    <div className={cn(
      "mt-3 rounded-lg border p-3 text-xs",
      validation.isValid
        ? "border-emerald-200 bg-emerald-50"
        : "border-red-200 bg-red-50"
    )}>
      <div className="flex items-center gap-1.5 mb-2 font-semibold">
        <Sparkles className="h-3.5 w-3.5 text-violet-500" />
        <span className="text-violet-700">ניתוח AI</span>
        {validation.documentAge && (
          <span className="text-slate-500 font-normal">· גיל מסמך: {validation.documentAge}</span>
        )}
      </div>
      <p className="text-slate-700 leading-relaxed mb-2">{validation.summary}</p>
      {validation.issues.length > 0 && (
        <ul className="list-inside list-disc space-y-1 text-red-700">
          {validation.issues.map((issue, i) => <li key={i}>{issue}</li>)}
        </ul>
      )}
      {validation.recommendations.length > 0 && (
        <ul className="mt-2 list-inside list-disc space-y-1 text-emerald-700">
          {validation.recommendations.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      )}
    </div>
  );
}

// ─── Single checklist row ─────────────────────────────────────────────────────

function ChecklistRow({
  item,
  onUploadClick,
  onApprove,
  onReject,
  isUploading,
  isReviewing,
}: {
  item: ChecklistItemDetail;
  onUploadClick: (item: ChecklistItemDetail) => void;
  onApprove: (item: ChecklistItemDetail) => void;
  onReject: (item: ChecklistItemDetail) => void;
  isUploading: boolean;
  isReviewing: boolean;
}) {
  const [expanded, setExpanded] = useState(
    item.status === "REJECTED" || (item.document?.aiValidation && !item.document.aiValidation.isValid)
  );
  const Icon = DOC_ICONS[item.documentType] ?? FileText;
  const doc = item.document;

  const isExpiryWarning =
    doc?.expiryDate &&
    new Date(doc.expiryDate).getTime() - Date.now() < 1000 * 60 * 60 * 24 * 30;

  return (
    <div className={cn("rounded-xl border transition-all", ROW_STYLE[item.status])}>
      {/* Main row */}
      <div className="flex items-center gap-3 p-3.5">
        {/* Status icon */}
        <StatusIcon status={item.status} />

        {/* Doc type icon */}
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm border border-slate-100">
          <Icon className="h-4.5 w-4.5 text-slate-500" />
        </div>

        {/* Name + meta */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-800 leading-tight">
              {item.displayName}
            </span>
            {item.isMandatory
              ? <span className="text-[10px] font-bold text-red-500 bg-red-50 border border-red-200 rounded px-1.5 py-0.5">חובה</span>
              : <span className="text-[10px] text-slate-400 bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5">אופציונלי</span>
            }
            {item.validityMonths && (
              <span className="text-[10px] text-slate-400">תוקף: {item.validityMonths} חודשים</span>
            )}
            <DocStatusBadge status={item.status} />
          </div>

          {/* Document meta when uploaded */}
          {doc && (
            <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
              <span className="font-mono">{doc.fileName}</span>
              <span>{fmtSize(doc.fileSize)}</span>
              {doc.issueDate && <span>הופק: {formatDate(doc.issueDate)}</span>}
              {doc.expiryDate && (
                <span className={cn(isExpiryWarning ? "text-amber-600 font-semibold" : "")}>
                  תפוגה: {formatDate(doc.expiryDate)}
                  {isExpiryWarning && " ⚠"}
                </span>
              )}
              {doc.uploadedByName && <span>הועלה על ידי: {doc.uploadedByName}</span>}
              {doc.isAiReviewed && (
                <span className="flex items-center gap-1 text-violet-600">
                  <Sparkles className="h-3 w-3" /> נותח על ידי AI
                </span>
              )}
            </div>
          )}

          {/* Rejection note */}
          {item.status === "REJECTED" && doc?.reviewNotes && (
            <p className="mt-1 text-xs text-red-600 font-medium">{doc.reviewNotes}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1.5">
          {(item.status === "MISSING" || item.status === "REJECTED" || item.status === "EXPIRED") && (
            <Button
              size="sm"
              variant={item.status === "MISSING" ? "primary" : "outline"}
              onClick={() => onUploadClick(item)}
              disabled={isUploading}
              className="gap-1.5 text-xs"
            >
              {isUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              {isUploading ? "מעלה..." : item.status === "MISSING" ? "העלה" : "העלה שוב"}
            </Button>
          )}
          {(item.status === "UPLOADED_PENDING_REVIEW" || item.status === "APPROVED") && doc && (
            <Button
              size="sm"
              variant="ghost"
              className="text-xs gap-1"
              onClick={() => window.open(`/api/documents/${doc.id}`, "_blank")}
            >
              <Eye className="h-3.5 w-3.5" />
              צפה
            </Button>
          )}

          {/* Staff review controls — only while the doc awaits review */}
          {item.status === "UPLOADED_PENDING_REVIEW" && doc && (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={isReviewing}
                onClick={() => onApprove(item)}
                className="gap-1 text-xs text-emerald-600 hover:bg-emerald-50"
              >
                {isReviewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                אשר
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={isReviewing}
                onClick={() => onReject(item)}
                className="gap-1 text-xs text-red-600 hover:bg-red-50"
              >
                <XCircle className="h-3.5 w-3.5" />
                דחה
              </Button>
            </>
          )}

          {/* Expand toggle (for description / AI analysis) */}
          {(item.description || doc?.aiValidation) && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-white hover:text-slate-600 transition-colors"
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          )}
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-dashed border-slate-200 px-4 pb-4 pt-3">
          {item.description && (
            <div className="flex items-start gap-1.5 text-xs text-slate-500 mb-2">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
              {item.description}
            </div>
          )}
          {doc?.aiValidation && <AiValidationPanel validation={doc.aiValidation} />}
        </div>
      )}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

type FilterKey = "all" | "missing" | "pending" | "approved" | "rejected";

const FILTER_LABELS: Record<FilterKey, string> = {
  all:      "הכל",
  missing:  "חסרים",
  pending:  "ממתין לבדיקה",
  approved: "מאושרים",
  rejected: "נדחו",
};

interface DocumentChecklistProps {
  items: ChecklistItemDetail[];
  caseId: string;
  documents: CaseDocument[];
}

type PendingUpload = { documentType: string; displayName: string; checklistItemId?: string };

export function DocumentChecklist({ items, caseId, documents }: DocumentChecklistProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [filter, setFilter] = useState<FilterKey>("all");
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [showOptional, setShowOptional] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [genOpen, setGenOpen] = useState(false);
  const [genType, setGenType] = useState<string>("MEDICAL_REPORT");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deletePending, startDelete] = useTransition();
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [, startReview] = useTransition();
  const [rejectTarget, setRejectTarget] = useState<ChecklistItemDetail | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingUpload = useRef<PendingUpload | null>(null);

  // ── Stats ──────────────────────────────────────────────────────────────────
  const approved  = items.filter((i) => i.status === "APPROVED");
  const missing   = items.filter((i) => i.status === "MISSING");
  const pending   = items.filter((i) => i.status === "UPLOADED_PENDING_REVIEW");
  const rejected  = items.filter((i) => i.status === "REJECTED");
  const expired   = items.filter((i) => i.status === "EXPIRED");
  const mandatory = items.filter((i) => i.isMandatory);
  const optional  = items.filter((i) => !i.isMandatory);
  const progressPct = items.length > 0 ? Math.round((approved.length / items.length) * 100) : 0;

  // ── Filter ──────────────────────────────────────────────────────────────────
  const FILTER_FN: Record<FilterKey, (i: ChecklistItemDetail) => boolean> = {
    all:      () => true,
    missing:  (i) => i.status === "MISSING" || i.status === "REJECTED" || i.status === "EXPIRED",
    pending:  (i) => i.status === "UPLOADED_PENDING_REVIEW",
    approved: (i) => i.status === "APPROVED",
    rejected: (i) => i.status === "REJECTED",
  };

  const visibleItems = items
    .filter((i) => i.isMandatory || showOptional)
    .filter(FILTER_FN[filter])
    .sort((a, b) => a.sortOrder - b.sortOrder);

  // ── Upload ──────────────────────────────────────────────────────────────────
  const triggerUpload = (payload: PendingUpload) => {
    setUploadError(null);
    setUploadSuccess(null);
    pendingUpload.current = payload;
    fileInputRef.current?.click();
  };

  const handleUploadClick = (item: ChecklistItemDetail) => {
    triggerUpload({ documentType: item.documentType, displayName: item.displayName, checklistItemId: item.id });
  };

  const handleGeneralUpload = () => {
    setGenOpen(false);
    triggerUpload({ documentType: genType, displayName: DOCUMENT_TYPE_LABELS[genType] ?? genType });
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const payload = pendingUpload.current;
    e.target.value = "";
    if (!file || !payload) return;

    // Client-side pre-checks (S3 enforces these too via the presigned policy).
    const ALLOWED = ["application/pdf", "image/png", "image/jpeg", "image/jpg"];
    if (file.size > 10 * 1024 * 1024) {
      setUploadError("הקובץ גדול מדי (מקסימום 10MB)");
      pendingUpload.current = null;
      return;
    }
    if (!ALLOWED.includes(file.type)) {
      setUploadError("סוג קובץ לא נתמך (PDF, JPG או PNG בלבד)");
      pendingUpload.current = null;
      return;
    }

    setUploadingId(payload.checklistItemId ?? "general");
    setUploadError(null);
    try {
      // 1) Ask the server for a presigned POST + a placeholder Document row.
      const presignRes = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId,
          documentType: payload.documentType,
          displayName: payload.displayName,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type,
          checklistItemId: payload.checklistItemId,
        }),
      });
      if (!presignRes.ok) {
        const data = await presignRes.json().catch(() => ({}));
        throw new Error(data.error ?? "יצירת ההעלאה נכשלה");
      }
      const { documentId, upload } = await presignRes.json();

      // 2) Upload the bytes straight to R2 via presigned PUT (raw file body).
      const s3res = await fetch(upload.url, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!s3res.ok) throw new Error("העלאת הקובץ ל-R2 נכשלה");

      // 3) Confirm — promote the row and link the checklist item.
      const confirmRes = await fetch(`/api/documents/${documentId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checklistItemId: payload.checklistItemId ?? null }),
      });
      if (!confirmRes.ok) {
        const data = await confirmRes.json().catch(() => ({}));
        throw new Error(data.error ?? "אישור ההעלאה נכשל");
      }

      setUploadSuccess(`המסמך "${payload.displayName}" הועלה בהצלחה`);
      startTransition(() => router.refresh());
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "העלאת המסמך נכשלה");
    } finally {
      setUploadingId(null);
      pendingUpload.current = null;
    }
  };

  const handleDeleteDocument = () => {
    if (!deleteId) return;
    setUploadError(null);
    setUploadSuccess(null);
    startDelete(async () => {
      try {
        await deleteDocument(deleteId);
        setDeleteId(null);
        setUploadSuccess("המסמך נמחק בהצלחה");
        router.refresh();
      } catch {
        setDeleteId(null);
        setUploadError("מחיקת המסמך נכשלה");
      }
    });
  };

  // ── Review (approve / reject) ────────────────────────────────────────────────
  const runReview = (item: ChecklistItemDetail, status: "APPROVED" | "REJECTED", notes?: string) => {
    if (!item.document) return;
    const docId = item.document.id;
    setUploadError(null);
    setUploadSuccess(null);
    setReviewingId(item.id);
    startReview(async () => {
      try {
        await reviewDocument(docId, status, notes);
        setUploadSuccess(
          status === "APPROVED"
            ? `המסמך "${item.displayName}" אושר`
            : `המסמך "${item.displayName}" נדחה`
        );
        router.refresh();
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : "פעולת הביקורת נכשלה");
      } finally {
        setReviewingId(null);
      }
    });
  };

  const handleApprove = (item: ChecklistItemDetail) => runReview(item, "APPROVED");
  const handleReject = (item: ChecklistItemDetail) => { setRejectReason(""); setRejectTarget(item); };
  const submitReject = () => {
    const item = rejectTarget;
    const reason = rejectReason.trim();
    if (!item || !reason) return;
    setRejectTarget(null);
    runReview(item, "REJECTED", reason);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept=".pdf,.jpg,.jpeg,.png"
        onChange={handleFileSelected}
      />

      {/* Summary bar */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-4 mb-3">
          <Progress value={progressPct} className="flex-1 min-w-[120px]" />
          <span className="text-sm font-semibold text-slate-700 whitespace-nowrap">
            {approved.length}/{items.length} מסמכים
          </span>
        </div>
        <div className="flex flex-wrap gap-3">
          {[
            { count: approved.length, label: "מאושרים", color: "text-emerald-600 bg-emerald-50 border-emerald-200" },
            { count: pending.length,  label: "ממתינים", color: "text-amber-600 bg-amber-50 border-amber-200" },
            { count: missing.length,  label: "חסרים",   color: "text-red-600 bg-red-50 border-red-200" },
            { count: rejected.length, label: "נדחו",    color: "text-red-700 bg-red-100 border-red-300" },
            { count: expired.length,  label: "פגי תוקף", color: "text-slate-500 bg-slate-50 border-slate-200" },
          ].map(({ count, label, color }) => count > 0 && (
            <span key={label} className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold", color)}>
              <span className="text-base font-bold leading-none">{count}</span>
              {label}
            </span>
          ))}
        </div>
      </div>

      {uploadError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {uploadError}
        </div>
      )}

      {uploadSuccess && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4 shrink-0" /> {uploadSuccess}
        </div>
      )}

      {/* Uploaded documents + general upload */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">מסמכים שהועלו ({documents.length})</h3>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => { setUploadError(null); setGenOpen(true); }}
            disabled={uploadingId === "general"}
          >
            {uploadingId === "general" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            העלה מסמך
          </Button>
        </div>
        {documents.length > 0 ? (
          <div className="flex flex-col divide-y divide-slate-100">
            {documents.map((d) => (
              <div key={d.id} className="flex items-center gap-3 py-2.5">
                <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-slate-800">{d.displayName}</p>
                  <p className="truncate text-[11px] text-slate-400">
                    {DOCUMENT_TYPE_LABELS[d.documentType] ?? d.documentType}
                    {d.fileName ? ` · ${d.fileName}` : ""}
                    {d.fileSize ? ` · ${fmtSize(d.fileSize)}` : ""}
                  </p>
                </div>
                <DocStatusBadge status={d.status} />
                <button
                  onClick={() => window.open(`/api/documents/${d.id}`, "_blank")}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-indigo-600 transition-colors"
                  aria-label="צפה / הורד"
                >
                  <Download className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setDeleteId(d.id)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                  aria-label="מחק מסמך"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="py-3 text-center text-xs text-slate-400">
            עדיין לא הועלו מסמכים לתיק. לחץ &quot;העלה מסמך&quot; כדי להתחיל.
          </p>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex flex-wrap items-center gap-1.5">
        {(Object.keys(FILTER_LABELS) as FilterKey[]).map((key) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
              filter === key
                ? "bg-indigo-600 text-white shadow-sm"
                : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-200"
            )}
          >
            {FILTER_LABELS[key]}
          </button>
        ))}

        <div className="ms-auto">
          <button
            onClick={() => setShowOptional((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50 transition-colors"
          >
            {showOptional ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            מסמכים אופציונליים ({optional.length})
          </button>
        </div>
      </div>

      {/* Mandatory section */}
      {mandatory.filter(FILTER_FN[filter]).length > 0 && (
        <section>
          <h3 className="mb-2.5 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400">
            <span className="h-px flex-1 bg-slate-200" />
            מסמכים חובה
            <span className="h-px flex-1 bg-slate-200" />
          </h3>
          <div className="flex flex-col gap-2.5">
            {mandatory
              .filter(FILTER_FN[filter])
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((item) => (
                <ChecklistRow
                  key={item.id}
                  item={item}
                  onUploadClick={handleUploadClick}
                  onApprove={handleApprove}
                  onReject={handleReject}
                  isUploading={uploadingId === item.id}
                  isReviewing={reviewingId === item.id}
                />
              ))}
          </div>
        </section>
      )}

      {/* Optional section */}
      {showOptional && optional.filter(FILTER_FN[filter]).length > 0 && (
        <section>
          <h3 className="mb-2.5 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400">
            <span className="h-px flex-1 bg-slate-200" />
            מסמכים אופציונליים
            <span className="h-px flex-1 bg-slate-200" />
          </h3>
          <div className="flex flex-col gap-2.5">
            {optional
              .filter(FILTER_FN[filter])
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((item) => (
                <ChecklistRow
                  key={item.id}
                  item={item}
                  onUploadClick={handleUploadClick}
                  onApprove={handleApprove}
                  onReject={handleReject}
                  isUploading={uploadingId === item.id}
                  isReviewing={reviewingId === item.id}
                />
              ))}
          </div>
        </section>
      )}

      {/* Empty state (checklist filter) */}
      {items.length > 0 && visibleItems.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-200 py-10 text-center">
          <CheckCircle2 className="h-8 w-8 text-emerald-400" />
          <p className="text-sm font-medium text-slate-600">אין פריטים בסינון זה</p>
        </div>
      )}

      {/* General upload type picker */}
      {genOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setGenOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">העלאת מסמך</h2>
              <button onClick={() => setGenOpen(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100" aria-label="סגור">
                <X className="h-5 w-5" />
              </button>
            </div>
            <label className="mb-1 block text-xs font-medium text-slate-600">סוג מסמך</label>
            <select
              value={genType}
              onChange={(e) => setGenType(e.target.value)}
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            >
              {Object.keys(DOCUMENT_TYPE_LABELS).map((t) => (
                <option key={t} value={t}>{DOCUMENT_TYPE_LABELS[t]}</option>
              ))}
            </select>
            <p className="mt-2 text-[11px] text-slate-400">PDF, JPG או PNG · עד 10MB</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setGenOpen(false)}>ביטול</Button>
              <Button size="sm" className="gap-1.5" onClick={handleGeneralUpload}>
                <Upload className="h-3.5 w-3.5" /> בחר קובץ
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Rejection reason modal */}
      {rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setRejectTarget(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">דחיית מסמך</h2>
              <button onClick={() => setRejectTarget(null)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100" aria-label="סגור">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mb-2 text-sm text-slate-600">
              דחיית <strong>{rejectTarget.displayName}</strong>. הסיבה תוצג ללקוח כדי שיוכל להעלות מסמך מתוקן.
            </p>
            <label className="mb-1 block text-xs font-medium text-slate-600">סיבת הדחייה</label>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              autoFocus
              placeholder="לדוגמה: המסמך מטושטש / חסר עמוד / פג תוקף"
              className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setRejectTarget(null)}>ביטול</Button>
              <Button variant="danger" size="sm" className="gap-1.5" disabled={!rejectReason.trim()} onClick={submitReject}>
                <XCircle className="h-3.5 w-3.5" /> דחה מסמך
              </Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deleteId !== null}
        danger
        title="מחיקת מסמך"
        confirmLabel="מחק מסמך"
        pending={deletePending}
        message="האם למחוק את המסמך? פעולה זו בלתי הפיכה."
        onConfirm={handleDeleteDocument}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
