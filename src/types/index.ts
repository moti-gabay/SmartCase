// Shared TypeScript types for the SmartCase application

export type UserRole = "ADMIN" | "SUPERVISOR" | "AGENT";
export type UserStatus = "PENDING_APPROVAL" | "APPROVED" | "SUSPENDED";
export type Gender = "MALE" | "FEMALE" | "OTHER";
export type EmploymentStatus = "EMPLOYED" | "SELF_EMPLOYED" | "UNEMPLOYED" | "RETIRED" | "STUDENT" | "UNABLE_TO_WORK";

export type CaseStatus =
  | "NEW_INTAKE"
  | "GATHERING_DOCUMENTS"
  | "PENDING_AI_REVIEW"
  | "READY_FOR_SUBMISSION"
  | "SUBMITTED"
  | "AWAITING_DECISION"
  | "APPROVED"
  | "REJECTED"
  | "APPEAL_IN_PROGRESS"
  | "CLOSED";

export type CaseType =
  | "DISABILITY_PENSION"
  | "GENERAL_DISABILITY_ALLOWANCE"
  | "MOBILITY_ALLOWANCE"
  | "INCOME_SUPPORT"
  | "LONG_TERM_CARE"
  | "SURVIVORS_BENEFIT"
  | "WORK_ACCIDENT"
  | "OCCUPATIONAL_DISEASE"
  | "APPEAL"
  | "CONVERSION"
  | "OTHER";

export type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

// Client-portal journey step (Phase 5 wizard) — order matters, see src/lib/portal/journey.ts
export type CaseStep =
  | "WELCOME"
  | "PROCESS_OVERVIEW"
  | "WIZARD_PERSONAL"
  | "WIZARD_FAMILY"
  | "WIZARD_BACKGROUND"
  | "PERSONAL_STORY"
  | "PENDING_DOCS"
  | "SCHEDULE_MEETING"
  | "TRACKING";

export type DocumentStatus = "MISSING" | "PENDING_UPLOAD" | "UPLOADED_PENDING_REVIEW" | "APPROVED" | "REJECTED" | "EXPIRED";
export type DocumentType =
  | "NATIONAL_ID" | "MEDICAL_REPORT" | "PSYCHIATRIC_EVALUATION"
  | "SALARY_SLIP" | "EMPLOYER_CONFIRMATION" | "BANK_STATEMENT"
  | "HOSPITALIZATION_SUMMARY" | "SPECIALIST_REFERRAL" | "PRESCRIPTION"
  | "LAB_RESULTS" | "INCOME_TAX_RETURN" | "SPOUSE_INCOME_PROOF"
  | "DISABILITY_CERTIFICATE" | "PHOTOGRAPH" | "AUTHORITY_DECISION_LETTER"
  | "APPEAL_LETTER" | "POWER_OF_ATTORNEY"
  | "RABBI_LETTER" | "COMMUNITY_LETTER" | "FAMILY_PHOTO" | "OTHER";

export type NoteType = "INTERNAL" | "CALL_LOG" | "EMAIL" | "MEETING" | "AUTHORITY_CONTACT" | "SYSTEM";
export type TaskStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type LetterType =
  | "CLAIM_REQUEST" | "APPEAL" | "SEVERITY_INCREASE" | "MEDICAL_COMMITTEE"
  | "AUTHORITY_INQUIRY" | "COVER_LETTER" | "OTHER";

export interface GeneratedLetterItem {
  id: string;
  letterType: LetterType;
  title: string;
  content: string;
  context?: string | null;
  createdAt: string;
  createdByName?: string | null;
}

// ─── View models (safe for client-side rendering) ─────────────────────────────

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatarUrl?: string | null;
}

// Row model for the admin user-management table.
export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  assignedCasesCount: number;
}

export interface ClientSummary {
  id: string;
  fullName: string;
  nationalId: string;
  phone: string;
  primaryCondition?: string | null;
}

export interface CaseSummary {
  id: string;
  caseNumber: string;
  clientId: string;
  clientName: string;
  caseType: CaseType;
  status: CaseStatus;
  priority: Priority;
  assignedAgentName?: string | null;
  hasMissingDocuments: boolean;
  isOverdue: boolean;
  nextFollowUpDate?: string | null;
  submissionDeadline?: string | null;
  missingDocsCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardStats {
  totalActiveCases: number;
  missingDocsCases: number;
  overdueCases: number;
  submittedThisMonth: number;
  approvedThisMonth: number;
  newCasesThisWeek: number;
}

export interface AlertItem {
  id: string;
  caseNumber: string;
  clientName: string;
  type: "missing_docs" | "overdue" | "deadline" | "decision_due";
  message: string;
  severity: "high" | "medium" | "low";
  caseId: string;
  date?: string;
}

export interface PipelineColumn {
  status: CaseStatus;
  label: string;
  cases: CaseSummary[];
  count: number;
}

// ─── Case Detail ───────────────────────────────────────────────────────────────

export interface UploadedDocument {
  id: string;
  fileName: string;
  fileSize: number;
  storageKey?: string;
  issueDate?: string;
  expiryDate?: string;
  aiSummary?: string;
  aiValidation?: {
    isValid: boolean;
    issues: string[];
    recommendations: string[];
    documentAge?: string;
    summary: string;
  };
  isAiReviewed: boolean;
  uploadedByName?: string;
  reviewNotes?: string;
  createdAt: string;
}

export interface CaseDocument {
  id: string;
  documentType: DocumentType;
  displayName: string;
  fileName?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
  status: DocumentStatus;
  isAiReviewed: boolean;
  uploadedByName?: string | null;
  createdAt: string;
}

export interface ChecklistItemDetail {
  id: string;
  documentType: DocumentType;
  displayName: string;
  description?: string;
  isMandatory: boolean;
  validityMonths?: number;
  sortOrder: number;
  status: DocumentStatus;
  document?: UploadedDocument;
}

export interface NoteDetail {
  id: string;
  type: NoteType;
  content: string;
  followUpDate?: string;
  isPrivate: boolean;
  authorName: string;
  authorInitials: string;
  createdAt: string;
}

export interface TaskDetail {
  id: string;
  title: string;
  description?: string;
  dueDate?: string;
  priority: Priority;
  status: TaskStatus;
  assignedToName?: string;
  completedAt?: string;
  createdAt: string;
}

export interface ConversionChildDetail {
  id: string;
  fullName: string;
  dateOfBirth?: string | null;
}

export interface ConversionProfileDetail {
  spouseFullName?: string | null;
  spouseNationalId?: string | null;
  spouseReligion?: string | null;
  communityName?: string | null;
  sponsoringRabbi?: string | null;
  courtName?: string | null;
  additionalNotes?: string | null;
  submittedAt?: string | null;
  children: ConversionChildDetail[];
}

export interface StatusHistoryEntry {
  id: string;
  previousStatus?: CaseStatus;
  newStatus: CaseStatus;
  changedByName: string;
  reason?: string;
  createdAt: string;
}

export type ActivityType =
  | "CASE_CREATED"
  | "DOCUMENT_UPLOADED"
  | "DOCUMENT_APPROVED"
  | "DOCUMENT_REJECTED"
  | "STEP_CHANGED"
  | "AI_CALL_SUMMARY";

export interface CaseActivityEntry {
  id: string;
  type: ActivityType;
  description: string;
  userName?: string | null;
  createdAt: string;
}

export interface CaseDetail {
  id: string;
  caseNumber: string;
  status: CaseStatus;
  caseType: CaseType;
  priority: Priority;
  claimedPercentage?: number;
  claimDescription?: string;
  authorityReferenceNumber?: string;
  submissionDate?: string;
  submissionDeadline?: string;
  decisionDate?: string;
  decisionDescription?: string;
  nextFollowUpDate?: string;
  lastContactDate?: string;
  isOverdue: boolean;
  hasMissingDocuments: boolean;
  portalStep: CaseStep;
  createdAt: string;
  updatedAt: string;

  client: {
    id: string;
    fullName: string;
    nationalId: string;
    dateOfBirth: string;
    gender: Gender;
    phone: string;
    email?: string;
    addressStreet?: string;
    addressCity?: string;
    employmentStatus: EmploymentStatus;
    employer?: string;
    monthlyIncome?: number;
    spouseIncome?: number;
    spouseName?: string;
    primaryCondition?: string;
    icdCode?: string;
    recognizedPercentage?: number;
    diagnosisDate?: string;
    treatingPhysician?: string;
  };

  assignedAgent?: { id: string; name: string; email: string };

  checklist: ChecklistItemDetail[];
  documents: CaseDocument[];
  notes: NoteDetail[];
  tasks: TaskDetail[];
  statusHistory: StatusHistoryEntry[];
  activities: CaseActivityEntry[];
  conversionProfile?: ConversionProfileDetail | null;
}

// ─── Client Detail (profile + edit) ─────────────────────────────────────────────

export interface ClientDetail {
  id: string;
  fullName: string;
  nationalId: string;
  dateOfBirth: string;
  gender: Gender;
  phone: string;
  email?: string | null;
  addressStreet?: string | null;
  addressCity?: string | null;
  addressZip?: string | null;
  employmentStatus: EmploymentStatus;
  employer?: string | null;
  monthlyIncome?: number | null;
  spouseIncome?: number | null;
  spouseName?: string | null;
  spouseNationalId?: string | null;
  primaryCondition?: string | null;
  icdCode?: string | null;
  recognizedPercentage?: number | null;
  diagnosisDate?: string | null;
  treatingPhysician?: string | null;
  isActive: boolean;
  internalNotes?: string | null;
  createdAt: string;
  cases: CaseSummary[];
}

// ─── Client List ───────────────────────────────────────────────────────────────

export interface ClientListItem {
  id: string;
  fullName: string;
  nationalId: string;
  dateOfBirth: string;
  gender: Gender;
  phone: string;
  email?: string;
  addressCity?: string;
  employmentStatus: EmploymentStatus;
  primaryCondition?: string;
  recognizedPercentage?: number;
  isActive: boolean;
  createdAt: string;
  // Derived from joined cases:
  activeCasesCount: number;
  totalCasesCount: number;
  lastCaseStatus?: CaseStatus;
  lastCaseType?: CaseType;
  hasMissingDocuments: boolean;
  assignedAgentName?: string;
  lastActivityDate?: string;
}

// ─── Tasks (cross-case list) ───────────────────────────────────────────────────

export interface TaskListItem {
  id: string;
  title: string;
  description?: string | null;
  dueDate?: string | null;
  priority: Priority;
  status: TaskStatus;
  completedAt?: string | null;
  createdAt: string;
  assignedToName?: string | null;
  caseId: string;
  caseNumber: string;
  clientName: string;
  isOverdue: boolean;
}

export type SortField = "fullName" | "createdAt" | "lastActivityDate" | "activeCasesCount" | "addressCity";
export type SortDir   = "asc" | "desc";
export interface ClientSort { field: SortField; dir: SortDir }

export interface ClientFilters {
  employmentStatus: EmploymentStatus[];
  cities:           string[];
  hasActiveCases:   "all" | "yes" | "no";
  hasMissingDocs:   boolean;
}
