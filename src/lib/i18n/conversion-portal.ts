// Lightweight, zero-dependency i18n dictionary for the public conversion
// portal (src/app/share/conversion/[token]). Plain data only — no framework,
// no routing changes. Client components hold `locale` in useState and index
// into this object directly; see conversion-portal-view.tsx.
//
// Scope note: this only translates UI copy and static labels. Server error
// strings returned by /api/public/conversion/... (e.g. "הטופס אינו תקין")
// are NOT translated — the API contract is intentionally left unchanged
// (see point 5 of the i18n request), so those messages always render in
// Hebrew regardless of the selected UI language. Client-side validation
// messages we generate ourselves (file too large, wrong type, etc.) ARE
// translated, since we own that copy end to end.
export type PortalLocale = "he" | "en" | "fr";

export const PORTAL_LOCALES: PortalLocale[] = ["he", "en", "fr"];

export const PORTAL_LOCALE_LABELS: Record<PortalLocale, string> = {
  he: "עברית",
  en: "English",
  fr: "Français",
};

export const PORTAL_LOCALE_DIR: Record<PortalLocale, "rtl" | "ltr"> = {
  he: "rtl",
  en: "ltr",
  fr: "ltr",
};

// Checklist item labels (displayName) come from the DB in Hebrew — that's the
// source of truth for "he" (no dictionary entry needed). English/French are
// keyed by the stable DocumentType enum value, not the Hebrew text, so they
// stay correct even if the Hebrew label copy changes later.
const DOCUMENT_TYPE_TRANSLATIONS: Record<"en" | "fr", Record<string, string>> = {
  en: {
    NATIONAL_ID: "National ID",
    RABBI_LETTER: "Rabbi's Recommendation Letter",
    COMMUNITY_LETTER: "Community Recommendation Letter",
    FAMILY_PHOTO: "Family Photo",
  },
  fr: {
    NATIONAL_ID: "Carte d'identité",
    RABBI_LETTER: "Lettre de recommandation du rabbin",
    COMMUNITY_LETTER: "Lettre de recommandation de la communauté",
    FAMILY_PHOTO: "Photo de famille",
  },
};

export function translateChecklistLabel(locale: PortalLocale, documentType: string, dbDisplayName: string): string {
  if (locale === "he") return dbDisplayName;
  return DOCUMENT_TYPE_TRANSLATIONS[locale][documentType] ?? dbDisplayName;
}

const he = {
  portalSubtitle: "פורטל לקוח – הליך גיור",
  footerNote: "המידע והמסמכים שתעלה כאן מועברים ישירות למשרד המטפל בתיקך.",

  invalidLinkTitle: "הקישור אינו תקין",
  invalidLinkBody: "הקישור שגוי או שפג תוקפו. אנא פנה למשרד לקבלת קישור מעודכן.",

  welcomeTitle: "ברוכים הבאים לפורטל הלקוח",
  welcomeBody:
    "המשרד מלווה אתכם לאורך כל הליך הגיור — מרגע פתיחת התיק ועד לקבלת ההכרה מבית הדין. " +
    "דרך העמוד הזה תוכלו לעדכן את הפרטים האישיים והמשפחתיים שלכם, ולהעלות את המסמכים הנדרשים " +
    "ישירות ובאופן מאובטח, ללא צורך בהדפסה או שליחה במייל.",
  step1: "איסוף פרטים ומסמכים",
  step2: "ליווי אישי מהמשרד",
  step3: "הגשה ומעקב עד להכרעה",

  personalTitle: "פרטים אישיים",
  fullName: "שם מלא",
  nationalId: "תעודת זהות",
  dateOfBirth: "תאריך לידה",
  age: "גיל",
  phone: "טלפון",
  email: "אימייל",
  addressCity: "עיר מגורים",

  familyTitle: "בן/בת זוג ומשפחה",
  spouseFullName: "שם בן/בת הזוג",
  spouseNationalId: "תעודת זהות בן/בת הזוג",
  spouseReligion: "דת בן/בת הזוג",
  communityName: "קהילה / בית כנסת",
  sponsoringRabbi: "רב מלווה",
  courtName: "בית דין",

  childrenLabel: "ילדים",
  addChild: "הוסף ילד/ה",
  noChildren: "אין ילדים רשומים",
  childNamePlaceholder: "שם מלא",

  additionalNotes: "הערות נוספות",

  saveButton: "שמור פרטים",
  saving: "שומר...",
  saveErrorFallback: "שמירת הפרטים נכשלה",
  saveSuccess: "הפרטים נשמרו בהצלחה",

  documentsTitle: "מסמכים נדרשים",
  documentsHint: "PDF, JPG או PNG · עד 10MB לקובץ",
  mandatory: "חובה",
  optional: "אופציונלי",
  upload: "העלה",
  uploading: "מעלה...",
  uploaded: "הועלה – החלף",
  fileTooLarge: "הקובץ גדול מדי (מקסימום 10MB)",
  fileTypeInvalid: "סוג קובץ לא נתמך (PDF, JPG או PNG בלבד)",
  uploadFailedFallback: "העלאת המסמך נכשלה",
};

const en: typeof he = {
  portalSubtitle: "Client Portal – Conversion Process",
  footerNote: "The information and documents you upload here are sent directly to the office handling your case.",

  invalidLinkTitle: "Invalid Link",
  invalidLinkBody: "This link is invalid or has expired. Please contact the office for an updated link.",

  welcomeTitle: "Welcome to the Client Portal",
  welcomeBody:
    "Our office guides you through every step of the conversion process — from opening your case to receiving " +
    "recognition from the rabbinical court. On this page you can update your personal and family details, and " +
    "securely upload the required documents directly, with no need to print or email anything.",
  step1: "Gathering details and documents",
  step2: "Personal guidance from the office",
  step3: "Submission and follow-up through to the ruling",

  personalTitle: "Personal Details",
  fullName: "Full Name",
  nationalId: "National ID",
  dateOfBirth: "Date of Birth",
  age: "Age",
  phone: "Phone",
  email: "Email",
  addressCity: "City of Residence",

  familyTitle: "Spouse & Family",
  spouseFullName: "Spouse's Full Name",
  spouseNationalId: "Spouse's National ID",
  spouseReligion: "Spouse's Religion",
  communityName: "Community / Synagogue",
  sponsoringRabbi: "Sponsoring Rabbi",
  courtName: "Rabbinical Court",

  childrenLabel: "Children",
  addChild: "Add Child",
  noChildren: "No children on record",
  childNamePlaceholder: "Full name",

  additionalNotes: "Additional Notes",

  saveButton: "Save Details",
  saving: "Saving...",
  saveErrorFallback: "Failed to save details",
  saveSuccess: "Details saved successfully",

  documentsTitle: "Required Documents",
  documentsHint: "PDF, JPG, or PNG · up to 10MB per file",
  mandatory: "Required",
  optional: "Optional",
  upload: "Upload",
  uploading: "Uploading...",
  uploaded: "Uploaded – Replace",
  fileTooLarge: "File is too large (10MB maximum)",
  fileTypeInvalid: "Unsupported file type (PDF, JPG, or PNG only)",
  uploadFailedFallback: "Document upload failed",
};

const fr: typeof he = {
  portalSubtitle: "Portail client – Processus de conversion",
  footerNote: "Les informations et documents que vous téléversez ici sont transmis directement au bureau responsable de votre dossier.",

  invalidLinkTitle: "Lien invalide",
  invalidLinkBody: "Ce lien est invalide ou a expiré. Veuillez contacter le bureau pour obtenir un lien à jour.",

  welcomeTitle: "Bienvenue sur le portail client",
  welcomeBody:
    "Notre bureau vous accompagne tout au long du processus de conversion — de l'ouverture de votre dossier " +
    "jusqu'à la reconnaissance par le tribunal rabbinique. Sur cette page, vous pouvez mettre à jour vos informations " +
    "personnelles et familiales, et téléverser les documents requis directement et en toute sécurité, sans besoin " +
    "d'impression ni d'envoi par courriel.",
  step1: "Collecte des informations et documents",
  step2: "Accompagnement personnalisé du bureau",
  step3: "Soumission et suivi jusqu'à la décision",

  personalTitle: "Informations personnelles",
  fullName: "Nom complet",
  nationalId: "Carte d'identité",
  dateOfBirth: "Date de naissance",
  age: "Âge",
  phone: "Téléphone",
  email: "E-mail",
  addressCity: "Ville de résidence",

  familyTitle: "Conjoint(e) et famille",
  spouseFullName: "Nom complet du conjoint(e)",
  spouseNationalId: "Carte d'identité du conjoint(e)",
  spouseReligion: "Religion du conjoint(e)",
  communityName: "Communauté / Synagogue",
  sponsoringRabbi: "Rabbin accompagnateur",
  courtName: "Tribunal rabbinique",

  childrenLabel: "Enfants",
  addChild: "Ajouter un enfant",
  noChildren: "Aucun enfant enregistré",
  childNamePlaceholder: "Nom complet",

  additionalNotes: "Remarques supplémentaires",

  saveButton: "Enregistrer",
  saving: "Enregistrement...",
  saveErrorFallback: "Échec de l'enregistrement",
  saveSuccess: "Informations enregistrées avec succès",

  documentsTitle: "Documents requis",
  documentsHint: "PDF, JPG ou PNG · 10 Mo maximum par fichier",
  mandatory: "Obligatoire",
  optional: "Facultatif",
  upload: "Téléverser",
  uploading: "Téléversement...",
  uploaded: "Téléversé – Remplacer",
  fileTooLarge: "Le fichier est trop volumineux (10 Mo maximum)",
  fileTypeInvalid: "Type de fichier non pris en charge (PDF, JPG ou PNG uniquement)",
  uploadFailedFallback: "Échec du téléversement du document",
};

export const portalDict: Record<PortalLocale, typeof he> = { he, en, fr };
export type PortalDict = typeof he;
