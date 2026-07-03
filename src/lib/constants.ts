// Hebrew labels for all enums used throughout the UI

export const CASE_STATUS_LABELS: Record<string, string> = {
  NEW_INTAKE:           "קליטה חדשה",
  GATHERING_DOCUMENTS:  "איסוף מסמכים",
  PENDING_AI_REVIEW:    "ממתין לסקירת AI",
  READY_FOR_SUBMISSION: "מוכן להגשה",
  SUBMITTED:            "הוגש",
  AWAITING_DECISION:    "ממתין להחלטה",
  APPROVED:             "אושר",
  REJECTED:             "נדחה",
  APPEAL_IN_PROGRESS:   "ערעור בתהליך",
  CLOSED:               "סגור",
};

export const CASE_STATUS_COLORS: Record<string, string> = {
  NEW_INTAKE:           "bg-indigo-100 text-indigo-700 border-indigo-200",
  GATHERING_DOCUMENTS:  "bg-amber-100 text-amber-700 border-amber-200",
  PENDING_AI_REVIEW:    "bg-violet-100 text-violet-700 border-violet-200",
  READY_FOR_SUBMISSION: "bg-cyan-100 text-cyan-700 border-cyan-200",
  SUBMITTED:            "bg-blue-100 text-blue-700 border-blue-200",
  AWAITING_DECISION:    "bg-orange-100 text-orange-700 border-orange-200",
  APPROVED:             "bg-emerald-100 text-emerald-700 border-emerald-200",
  REJECTED:             "bg-red-100 text-red-700 border-red-200",
  APPEAL_IN_PROGRESS:   "bg-pink-100 text-pink-700 border-pink-200",
  CLOSED:               "bg-slate-100 text-slate-600 border-slate-200",
};

export const CASE_STATUS_DOT: Record<string, string> = {
  NEW_INTAKE:           "bg-indigo-500",
  GATHERING_DOCUMENTS:  "bg-amber-500",
  PENDING_AI_REVIEW:    "bg-violet-500",
  READY_FOR_SUBMISSION: "bg-cyan-500",
  SUBMITTED:            "bg-blue-500",
  AWAITING_DECISION:    "bg-orange-500",
  APPROVED:             "bg-emerald-500",
  REJECTED:             "bg-red-500",
  APPEAL_IN_PROGRESS:   "bg-pink-500",
  CLOSED:               "bg-slate-400",
};

export const CASE_TYPE_LABELS: Record<string, string> = {
  DISABILITY_PENSION:             "קצבת נכות",
  GENERAL_DISABILITY_ALLOWANCE:   "גמלת נכות כללית",
  MOBILITY_ALLOWANCE:             "קצבת ניידות",
  INCOME_SUPPORT:                 "הבטחת הכנסה",
  LONG_TERM_CARE:                 "שירותים מיוחדים",
  SURVIVORS_BENEFIT:              "קצבת שאירים",
  WORK_ACCIDENT:                  "תאונת עבודה",
  OCCUPATIONAL_DISEASE:           "מחלת מקצוע",
  APPEAL:                         "ערעור",
  OTHER:                          "אחר",
};

export const PRIORITY_LABELS: Record<string, string> = {
  LOW:    "נמוכה",
  MEDIUM: "בינונית",
  HIGH:   "גבוהה",
  URGENT: "דחופה",
};

export const PRIORITY_COLORS: Record<string, string> = {
  LOW:    "text-slate-500",
  MEDIUM: "text-blue-600",
  HIGH:   "text-orange-500",
  URGENT: "text-red-600",
};

export const PRIORITY_BG: Record<string, string> = {
  LOW:    "bg-slate-100",
  MEDIUM: "bg-blue-50",
  HIGH:   "bg-orange-50",
  URGENT: "bg-red-50",
};

export const DOCUMENT_STATUS_LABELS: Record<string, string> = {
  MISSING:                "חסר",
  UPLOADED_PENDING_REVIEW: "הועלה – ממתין לבדיקה",
  APPROVED:               "אושר",
  REJECTED:               "נדחה",
  EXPIRED:                "פג תוקף",
};

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  NATIONAL_ID:               "תעודת זהות",
  MEDICAL_REPORT:            "דו״ח רפואי",
  PSYCHIATRIC_EVALUATION:    "חוות דעת פסיכיאטרית",
  SALARY_SLIP:               "תלוש שכר",
  EMPLOYER_CONFIRMATION:     "אישור מעסיק",
  BANK_STATEMENT:            "דפי חשבון בנק",
  HOSPITALIZATION_SUMMARY:   "סיכום אשפוז",
  SPECIALIST_REFERRAL:       "הפניה לרופא מומחה",
  PRESCRIPTION:              "מרשם רפואי",
  LAB_RESULTS:               "תוצאות בדיקות מעבדה",
  INCOME_TAX_RETURN:         "החזר מס הכנסה",
  SPOUSE_INCOME_PROOF:       "הוכחת הכנסת בן/בת זוג",
  DISABILITY_CERTIFICATE:    "תעודת נכות",
  PHOTOGRAPH:                "תמונת פנים",
  AUTHORITY_DECISION_LETTER: "מכתב החלטת רשות",
  APPEAL_LETTER:             "מכתב ערעור",
  POWER_OF_ATTORNEY:         "ייפוי כוח",
  OTHER:                     "אחר",
};

export const NOTE_TYPE_LABELS: Record<string, string> = {
  INTERNAL:          "הערה פנימית",
  CALL_LOG:          "שיחת טלפון",
  EMAIL:             "אימייל",
  MEETING:           "פגישה",
  AUTHORITY_CONTACT: "פנייה לרשות",
  SYSTEM:            "אירוע מערכת",
};

export const EMPLOYMENT_STATUS_LABELS: Record<string, string> = {
  EMPLOYED:      "שכיר",
  SELF_EMPLOYED: "עצמאי",
  UNEMPLOYED:    "מובטל",
  RETIRED:       "פנסיונר",
  STUDENT:       "סטודנט",
  UNABLE_TO_WORK:"לא מסוגל לעבוד",
};

export const GENDER_LABELS: Record<string, string> = {
  MALE:   "זכר",
  FEMALE: "נקבה",
  OTHER:  "אחר",
};

export const LETTER_TYPE_LABELS: Record<string, string> = {
  CLAIM_REQUEST:     "מכתב בקשה / תביעה",
  APPEAL:            "מכתב ערעור",
  SEVERITY_INCREASE: "בקשה להחמרה / הגדלת אחוזים",
  MEDICAL_COMMITTEE: "בקשה לוועדה רפואית",
  AUTHORITY_INQUIRY: "פנייה / בירור מול הרשות",
  COVER_LETTER:      "מכתב מלווה לצירוף מסמכים",
  OTHER:             "מכתב כללי",
};

// Purpose hint injected into the Claude prompt per letter type.
export const LETTER_TYPE_INSTRUCTIONS: Record<string, string> = {
  CLAIM_REQUEST:     "מכתב בקשה/תביעה ראשונית להכרה בזכאות מול המוסד לביטוח לאומי.",
  APPEAL:            "מכתב ערעור מנומק על החלטת הוועדה/הרשות, כולל בקשה לבחינה מחדש.",
  SEVERITY_INCREASE: "בקשה לבחינה מחדש של אחוזי הנכות עקב החמרה במצב הרפואי.",
  MEDICAL_COMMITTEE: "בקשה בנוגע לוועדה רפואית (זימון, דחייה, או ערר על החלטת ועדה).",
  AUTHORITY_INQUIRY: "פנייה רשמית לבירור סטטוס התיק או קבלת מידע מהרשות.",
  COVER_LETTER:      "מכתב מלווה קצר ורשמי המצרף מסמכים לתיק.",
  OTHER:             "מכתב רשמי כללי בהתאם לפרטי הבקשה.",
};

export const PIPELINE_COLUMNS = [
  "NEW_INTAKE",
  "GATHERING_DOCUMENTS",
  "PENDING_AI_REVIEW",
  "READY_FOR_SUBMISSION",
  "SUBMITTED",
  "AWAITING_DECISION",
  "APPROVED",
  "REJECTED",
  "APPEAL_IN_PROGRESS",
] as const;
