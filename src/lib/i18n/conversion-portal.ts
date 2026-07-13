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

// Checklist item guidance text (template.description) — same pattern as the
// labels above: Hebrew comes from the DB (source of truth), en/fr are keyed by
// the stable DocumentType enum value, never by matching the Hebrew string.
const DOCUMENT_TYPE_DESCRIPTIONS: Record<"en" | "fr", Record<string, string>> = {
  en: {
    NATIONAL_ID: "Please upload a clear photo or scan of your national ID, including the appendix.",
    RABBI_LETTER: "Please upload a recommendation letter signed by your sponsoring rabbi, on official letterhead.",
    COMMUNITY_LETTER: "Please upload a letter from your community or synagogue confirming your participation in community life.",
    FAMILY_PHOTO: "Optional: a recent family photo to accompany your file.",
  },
  fr: {
    NATIONAL_ID: "Veuillez téléverser une photo ou un scan lisible de votre carte d'identité, annexe comprise.",
    RABBI_LETTER: "Veuillez téléverser une lettre de recommandation signée par votre rabbin accompagnateur, sur papier à en-tête officiel.",
    COMMUNITY_LETTER: "Veuillez téléverser une lettre de votre communauté ou synagogue confirmant votre participation à la vie communautaire.",
    FAMILY_PHOTO: "Facultatif : une photo de famille récente pour accompagner votre dossier.",
  },
};

export function translateChecklistDescription(
  locale: PortalLocale,
  documentType: string,
  dbDescription: string | null
): string | null {
  if (locale === "he") return dbDescription;
  return DOCUMENT_TYPE_DESCRIPTIONS[locale][documentType] ?? dbDescription;
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
  docRejectedReason: "המסמך נדחה – נא להעלות מסמך מתוקן. סיבה:",
  fileTooLarge: "הקובץ גדול מדי (מקסימום 10MB)",
  fileTypeInvalid: "סוג קובץ לא נתמך (PDF, JPG או PNG בלבד)",
  uploadFailedFallback: "העלאת המסמך נכשלה",

  // ── Wizard navigation & chrome ──
  navStart: "התחלת התהליך",
  navContinue: "המשך",
  navAcknowledge: "הבנתי, נמשיך",
  navBack: "חזרה",
  navBusy: "שומר...",
  progressLabel: "שלב",

  welcomeHeroTitle: "ברוכים הבאים למרכז הליווי לגיור",
  welcomeHeroBody:
    "אנחנו כאן כדי ללוות אתכם צעד אחר צעד לאורך כל הליך הגיור. " +
    "התהליך מחולק לשלבים קצרים וברורים — נתקדם יחד, בקצב שלכם.",

  overviewTitle: "מה צפוי בהמשך",
  overviewSubtitle: "ששת שלבי הליווי העיקריים",
  overviewPhases: [
    { title: "פתיחת תיק וליווי ראשוני", subtitle: "היכרות והגדרת הצרכים שלכם" },
    { title: "איסוף פרטים ומסמכים", subtitle: "מילוי הפרטים והעלאת המסמכים הנדרשים" },
    { title: "הכנה אישית ולימוד", subtitle: "ליווי אישי לקראת המפגש עם בית הדין" },
    { title: "הגשה לבית הדין", subtitle: "המשרד מגיש את התיק המלא בשמכם" },
    { title: "מפגש עם בית הדין", subtitle: "הופעה בפני הדיינים לקבלת ההחלטה" },
    { title: "קבלת ההכרה", subtitle: "סיום ההליך וקבלת תעודת הגיור" },
  ],

  personalIntro: "נעדכן את פרטי הקשר שלכם",
  familyIntro: "פרטי בן/בת הזוג והילדים (אם ישנם)",
  backgroundIntro: "הרקע הקהילתי והדתי שלכם",
  storyTitle: "הסיפור האישי שלכם",
  storyIntro: "ספרו לנו במילים שלכם על המסע האישי שהביא אתכם עד הלום — הרקע, המניעים והדרך.",
  storyPlaceholder: "כתבו כאן את הסיפור האישי שלכם...",
  docsIntro: "להשלמת התיק, נא להעלות את המסמכים הבאים",

  stepErrors: {
    MISSING_CONTACT_FIELDS: "יש למלא טלפון, אימייל ועיר מגורים כדי להמשיך",
    FAMILY_NOT_SAVED: "יש לשמור את פרטי המשפחה כדי להמשיך",
    MISSING_BACKGROUND_FIELDS: "יש למלא קהילה ורב מלווה כדי להמשיך",
    MISSING_PERSONAL_STORY: "יש לכתוב את הסיפור האישי כדי להמשיך",
    MISSING_MANDATORY_DOCUMENTS: "יש להעלות את כל מסמכי החובה כדי להמשיך",
    GENERIC: "לא ניתן להמשיך כרגע, נסו שוב מאוחר יותר",
  },

  awaitingTitle: "התיק שלכם התקדם בהצלחה 🎉",
  awaitingBody: "קיבלנו את כל הפרטים והמסמכים. המשרד ייצור איתכם קשר בהקדם לתיאום המשך התהליך.",
  trackingTitle: "הבקשה שלכם בטיפול",
  trackingBody: "התיק נמצא כעת בטיפול המשרד ובבית הדין. נעדכן אתכם בכל התקדמות.",
  timelineTitle: "מעקב התקדמות",
  timelineEmpty: "אין עדיין עדכונים להצגה.",
  activityDocApproved: "מסמך אושר",
  activityDocRejected: "מסמך נדרש בתיקון",
  activityStepChanged: "התהליך התקדם לשלב הבא",
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
  docRejectedReason: "Document rejected – please upload a corrected file. Reason:",
  fileTooLarge: "File is too large (10MB maximum)",
  fileTypeInvalid: "Unsupported file type (PDF, JPG, or PNG only)",
  uploadFailedFallback: "Document upload failed",

  // ── Wizard navigation & chrome ──
  navStart: "Start the process",
  navContinue: "Continue",
  navAcknowledge: "Got it, continue",
  navBack: "Back",
  navBusy: "Saving...",
  progressLabel: "Step",

  welcomeHeroTitle: "Welcome to the Conversion Guidance Center",
  welcomeHeroBody:
    "We're here to guide you step by step through the entire conversion process. " +
    "It's broken into short, clear stages — we'll move forward together, at your pace.",

  overviewTitle: "What to expect",
  overviewSubtitle: "The six main stages of the process",
  overviewPhases: [
    { title: "Case opening & first contact", subtitle: "Getting to know you and your needs" },
    { title: "Gathering details & documents", subtitle: "Filling in details and uploading required documents" },
    { title: "Personal preparation & study", subtitle: "Personal guidance toward the court hearing" },
    { title: "Submission to the court", subtitle: "The office submits your complete file on your behalf" },
    { title: "Court hearing", subtitle: "Appearing before the judges for the decision" },
    { title: "Receiving recognition", subtitle: "Completing the process and receiving your certificate" },
  ],

  personalIntro: "Let's update your contact details",
  familyIntro: "Spouse and children details (if any)",
  backgroundIntro: "Your community and religious background",
  storyTitle: "Your personal story",
  storyIntro: "Tell us, in your own words, about the personal journey that brought you here — your background, motivations, and path.",
  storyPlaceholder: "Write your personal story here...",
  docsIntro: "To complete your file, please upload the following documents",

  stepErrors: {
    MISSING_CONTACT_FIELDS: "Please fill in phone, email, and city to continue",
    FAMILY_NOT_SAVED: "Please save your family details to continue",
    MISSING_BACKGROUND_FIELDS: "Please fill in community and sponsoring rabbi to continue",
    MISSING_PERSONAL_STORY: "Please write your personal story to continue",
    MISSING_MANDATORY_DOCUMENTS: "Please upload all required documents to continue",
    GENERIC: "Cannot continue right now, please try again later",
  },

  awaitingTitle: "Your file has advanced successfully 🎉",
  awaitingBody: "We've received all your details and documents. The office will contact you shortly to arrange the next steps.",
  trackingTitle: "Your application is being processed",
  trackingBody: "Your file is now being handled by the office and the court. We'll keep you updated on any progress.",
  timelineTitle: "Progress tracker",
  timelineEmpty: "No updates to show yet.",
  activityDocApproved: "A document was approved",
  activityDocRejected: "A document needs revision",
  activityStepChanged: "Your process advanced to the next step",
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
  docRejectedReason: "Document refusé – veuillez téléverser un fichier corrigé. Raison :",
  fileTooLarge: "Le fichier est trop volumineux (10 Mo maximum)",
  fileTypeInvalid: "Type de fichier non pris en charge (PDF, JPG ou PNG uniquement)",
  uploadFailedFallback: "Échec du téléversement du document",

  // ── Wizard navigation & chrome ──
  navStart: "Commencer le processus",
  navContinue: "Continuer",
  navAcknowledge: "J'ai compris, continuer",
  navBack: "Retour",
  navBusy: "Enregistrement...",
  progressLabel: "Étape",

  welcomeHeroTitle: "Bienvenue au Centre d'accompagnement à la conversion",
  welcomeHeroBody:
    "Nous sommes là pour vous accompagner étape par étape tout au long du processus de conversion. " +
    "Il est divisé en étapes courtes et claires — nous avancerons ensemble, à votre rythme.",

  overviewTitle: "À quoi s'attendre",
  overviewSubtitle: "Les six principales étapes du processus",
  overviewPhases: [
    { title: "Ouverture du dossier & premier contact", subtitle: "Faire connaissance et définir vos besoins" },
    { title: "Collecte des informations & documents", subtitle: "Remplir les informations et téléverser les documents requis" },
    { title: "Préparation personnelle & étude", subtitle: "Accompagnement personnel vers l'audience du tribunal" },
    { title: "Soumission au tribunal", subtitle: "Le bureau soumet votre dossier complet en votre nom" },
    { title: "Audience du tribunal", subtitle: "Comparution devant les juges pour la décision" },
    { title: "Obtention de la reconnaissance", subtitle: "Finalisation du processus et remise du certificat" },
  ],

  personalIntro: "Mettons à jour vos coordonnées",
  familyIntro: "Détails du conjoint et des enfants (le cas échéant)",
  backgroundIntro: "Votre contexte communautaire et religieux",
  storyTitle: "Votre histoire personnelle",
  storyIntro: "Racontez-nous, avec vos propres mots, le parcours personnel qui vous a mené jusqu'ici — votre contexte, vos motivations et votre cheminement.",
  storyPlaceholder: "Écrivez votre histoire personnelle ici...",
  docsIntro: "Pour compléter votre dossier, veuillez téléverser les documents suivants",

  stepErrors: {
    MISSING_CONTACT_FIELDS: "Veuillez renseigner téléphone, e-mail et ville pour continuer",
    FAMILY_NOT_SAVED: "Veuillez enregistrer vos informations familiales pour continuer",
    MISSING_BACKGROUND_FIELDS: "Veuillez renseigner la communauté et le rabbin accompagnateur pour continuer",
    MISSING_PERSONAL_STORY: "Veuillez rédiger votre histoire personnelle pour continuer",
    MISSING_MANDATORY_DOCUMENTS: "Veuillez téléverser tous les documents obligatoires pour continuer",
    GENERIC: "Impossible de continuer pour le moment, veuillez réessayer plus tard",
  },

  awaitingTitle: "Votre dossier a bien progressé 🎉",
  awaitingBody: "Nous avons reçu toutes vos informations et documents. Le bureau vous contactera prochainement pour organiser la suite.",
  trackingTitle: "Votre demande est en cours de traitement",
  trackingBody: "Votre dossier est désormais pris en charge par le bureau et le tribunal. Nous vous tiendrons informé de toute avancée.",
  timelineTitle: "Suivi de progression",
  timelineEmpty: "Aucune mise à jour à afficher pour le moment.",
  activityDocApproved: "Un document a été approuvé",
  activityDocRejected: "Un document doit être corrigé",
  activityStepChanged: "Votre dossier est passé à l'étape suivante",
};

export const portalDict: Record<PortalLocale, typeof he> = { he, en, fr };
export type PortalDict = typeof he;
