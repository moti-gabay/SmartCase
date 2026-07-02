import "dotenv/config";
import { PrismaClient, UserRole, CaseType, CaseStatus, Priority, DocumentType, Gender, EmploymentStatus } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

// Prisma 7: the driver adapter owns the connection. CLI/seed use DIRECT_URL.
const adapter = new PrismaPg(process.env.DIRECT_URL ?? process.env.DATABASE_URL!);
// @ts-ignore – constructor accepts adapter in Prisma 7
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("🌱 Starting seed...");

  // ── Users ──────────────────────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash("SmartCase123!", 10);

  const admin = await prisma.user.upsert({
    where: { email: "admin@smartcase.co.il" },
    update: {},
    create: {
      name: "מנהל מערכת",
      email: "admin@smartcase.co.il",
      passwordHash,
      role: UserRole.ADMIN,
    },
  });

  const agent1 = await prisma.user.upsert({
    where: { email: "magi@smartcase.co.il" },
    update: {},
    create: {
      name: "מגי לוי",
      email: "magi@smartcase.co.il",
      passwordHash,
      role: UserRole.AGENT,
    },
  });

  const agent2 = await prisma.user.upsert({
    where: { email: "dana@smartcase.co.il" },
    update: {},
    create: {
      name: "דנה ברק",
      email: "dana@smartcase.co.il",
      passwordHash,
      role: UserRole.AGENT,
    },
  });

  console.log("✅ Users created");

  // ── Document Checklist Templates (DISABILITY_PENSION) ──────────────────────
  const pensionDocs = [
    { documentType: DocumentType.NATIONAL_ID,            displayName: "תעודת זהות", isMandatory: true,  sortOrder: 1 },
    { documentType: DocumentType.MEDICAL_REPORT,         displayName: "דו״ח רפואי מרופא מטפל", isMandatory: true,  sortOrder: 2 },
    { documentType: DocumentType.SALARY_SLIP,            displayName: "תלושי שכר (3 חודשים)",  isMandatory: true,  sortOrder: 3, validityMonths: 3 },
    { documentType: DocumentType.EMPLOYER_CONFIRMATION,  displayName: "אישור מעסיק",           isMandatory: true,  sortOrder: 4 },
    { documentType: DocumentType.BANK_STATEMENT,         displayName: "דפי חשבון בנק",         isMandatory: true,  sortOrder: 5, validityMonths: 3 },
    { documentType: DocumentType.DISABILITY_CERTIFICATE, displayName: "תעודת נכות קיימת",      isMandatory: false, sortOrder: 6 },
    { documentType: DocumentType.PHOTOGRAPH,             displayName: "תמונת פנים",             isMandatory: true,  sortOrder: 7 },
  ];

  for (const doc of pensionDocs) {
    await prisma.documentChecklistTemplate.upsert({
      where: { caseType_documentType: { caseType: CaseType.DISABILITY_PENSION, documentType: doc.documentType } },
      update: {},
      create: { caseType: CaseType.DISABILITY_PENSION, ...doc },
    });
  }

  console.log("✅ Checklist templates created");

  // ── Clients & Cases ────────────────────────────────────────────────────────
  const client1 = await prisma.client.upsert({
    where: { nationalId: "123456789" },
    update: {},
    create: {
      fullName: "שרה כהן",
      nationalId: "123456789",
      dateOfBirth: new Date("1975-03-15"),
      gender: Gender.FEMALE,
      phone: "052-1234567",
      email: "sarah@example.com",
      addressStreet: "רחוב הרצל 12",
      addressCity: "תל אביב",
      employmentStatus: EmploymentStatus.EMPLOYED,
      monthlyIncome: 8500,
      primaryCondition: "פיברומיאלגיה",
      icdCode: "M79.7",
      recognizedPercentage: 40,
      diagnosisDate: new Date("2020-06-01"),
    },
  });

  const case1 = await prisma.case.upsert({
    where: { caseNumber: "SC-2024-00341" },
    update: {},
    create: {
      caseNumber: "SC-2024-00341",
      clientId: client1.id,
      assignedAgentId: agent1.id,
      createdById: admin.id,
      caseType: CaseType.DISABILITY_PENSION,
      status: CaseStatus.GATHERING_DOCUMENTS,
      priority: Priority.HIGH,
      claimedPercentage: 65,
      claimDescription: "בקשה להגדלת אחוזי נכות עקב החמרה בפיברומיאלגיה ומחלות נלוות.",
      nextFollowUpDate: new Date("2024-12-05"),
    },
  });

  await prisma.caseStatusHistory.create({
    data: {
      caseId: case1.id,
      changedById: admin.id,
      previousStatus: null,
      newStatus: CaseStatus.NEW_INTAKE,
    },
  });

  await prisma.note.create({
    data: {
      caseId: case1.id,
      authorId: agent1.id,
      type: "CALL_LOG",
      content: "שיחה עם הלקוחה – אישרה שתשלח מסמכים רפואיים עד סוף השבוע.",
      followUpDate: new Date("2024-12-05"),
    },
  });

  console.log("✅ Sample client and case created");

  // ── Additional mock clients & cases (for testing) ──────────────────────────
  const agents = [agent1, agent2];
  const mockData: Array<{
    fullName: string;
    nationalId: string;
    dateOfBirth: string;
    gender: Gender;
    phone: string;
    email?: string;
    addressCity?: string;
    employmentStatus: EmploymentStatus;
    monthlyIncome?: number;
    primaryCondition?: string;
    recognizedPercentage?: number;
    caseNumber: string;
    caseType: CaseType;
    status: CaseStatus;
    priority: Priority;
    claimedPercentage?: number;
    claimDescription?: string;
    hasMissingDocuments: boolean;
    isOverdue?: boolean;
    assignedAgentIndex?: number; // index into `agents`, undefined = unassigned
    submissionDeadline?: string;
    nextFollowUpDate?: string;
  }> = [
    {
      fullName: "משה לוי", nationalId: "234567891", dateOfBirth: "1958-07-22", gender: Gender.MALE,
      phone: "054-9876543", email: "moshe.levy@walla.co.il", addressCity: "ירושלים",
      employmentStatus: EmploymentStatus.RETIRED, primaryCondition: "מחלת פרקינסון", recognizedPercentage: 65,
      caseNumber: "SC-2024-00289", caseType: CaseType.MOBILITY_ALLOWANCE, status: CaseStatus.GATHERING_DOCUMENTS,
      priority: Priority.URGENT, claimedPercentage: 75, hasMissingDocuments: true, isOverdue: true,
      assignedAgentIndex: 1, submissionDeadline: "2026-07-10", nextFollowUpDate: "2026-07-05",
    },
    {
      fullName: "רחל מזרחי", nationalId: "345678912", dateOfBirth: "1980-12-01", gender: Gender.FEMALE,
      phone: "050-1112233", email: "rachel.m@hotmail.com", addressCity: "חיפה",
      employmentStatus: EmploymentStatus.UNABLE_TO_WORK, primaryCondition: "טרשת נפוצה", recognizedPercentage: 50,
      caseNumber: "SC-2024-00198", caseType: CaseType.GENERAL_DISABILITY_ALLOWANCE, status: CaseStatus.PENDING_AI_REVIEW,
      priority: Priority.MEDIUM, claimedPercentage: 70, hasMissingDocuments: false,
      assignedAgentIndex: 0, nextFollowUpDate: "2026-07-15",
    },
    {
      fullName: "יוסף אברהם", nationalId: "456789123", dateOfBirth: "1969-04-18", gender: Gender.MALE,
      phone: "052-4455667", email: "yosef.a@gmail.com", addressCity: "באר שבע",
      employmentStatus: EmploymentStatus.SELF_EMPLOYED, monthlyIncome: 11000, primaryCondition: "פגיעת גב כרונית", recognizedPercentage: 30,
      caseNumber: "SC-2024-00156", caseType: CaseType.DISABILITY_PENSION, status: CaseStatus.READY_FOR_SUBMISSION,
      priority: Priority.HIGH, claimedPercentage: 55, hasMissingDocuments: false,
      assignedAgentIndex: 0, submissionDeadline: "2026-07-08",
    },
    {
      fullName: "מרים פרידמן", nationalId: "567891234", dateOfBirth: "1972-09-30", gender: Gender.FEMALE,
      phone: "053-7788990", addressCity: "נתניה", employmentStatus: EmploymentStatus.UNEMPLOYED,
      primaryCondition: "דיכאון קליני", recognizedPercentage: 40,
      caseNumber: "SC-2024-00132", caseType: CaseType.INCOME_SUPPORT, status: CaseStatus.SUBMITTED,
      priority: Priority.MEDIUM, hasMissingDocuments: false, assignedAgentIndex: 1, nextFollowUpDate: "2026-08-01",
    },
    {
      fullName: "דוד כץ", nationalId: "678912345", dateOfBirth: "1965-01-12", gender: Gender.MALE,
      phone: "054-2233445", email: "david.katz@gmail.com", addressCity: "פתח תקווה",
      employmentStatus: EmploymentStatus.EMPLOYED, monthlyIncome: 14500, primaryCondition: "פגיעה בכתף – תאונת עבודה", recognizedPercentage: 20,
      caseNumber: "SC-2024-00098", caseType: CaseType.WORK_ACCIDENT, status: CaseStatus.AWAITING_DECISION,
      priority: Priority.HIGH, claimedPercentage: 45, hasMissingDocuments: false, assignedAgentIndex: 0, nextFollowUpDate: "2026-07-20",
    },
    {
      fullName: "אורית שוחט", nationalId: "789123456", dateOfBirth: "1955-11-05", gender: Gender.FEMALE,
      phone: "050-6677889", addressCity: "רעננה", employmentStatus: EmploymentStatus.RETIRED,
      primaryCondition: "אוסטאופורוזיס", recognizedPercentage: 60,
      caseNumber: "SC-2024-00071", caseType: CaseType.DISABILITY_PENSION, status: CaseStatus.APPROVED,
      priority: Priority.LOW, hasMissingDocuments: false, assignedAgentIndex: 1,
    },
    {
      fullName: "ניר בן-דוד", nationalId: "891234567", dateOfBirth: "1988-06-25", gender: Gender.MALE,
      phone: "052-9900112", email: "nir.bd@gmail.com", addressCity: "תל אביב-יפו",
      employmentStatus: EmploymentStatus.EMPLOYED, monthlyIncome: 9800, primaryCondition: "חרדה כללית", recognizedPercentage: 25,
      caseNumber: "SC-2024-00062", caseType: CaseType.GENERAL_DISABILITY_ALLOWANCE, status: CaseStatus.REJECTED,
      priority: Priority.HIGH, claimedPercentage: 50, hasMissingDocuments: false, assignedAgentIndex: 1, nextFollowUpDate: "2026-07-07",
    },
    {
      fullName: "ספיר גל", nationalId: "912345678", dateOfBirth: "1990-02-14", gender: Gender.FEMALE,
      phone: "054-3344556", email: "sapir.gal@walla.co.il", addressCity: "אשדוד",
      employmentStatus: EmploymentStatus.STUDENT, primaryCondition: "אפילפסיה", recognizedPercentage: 35,
      caseNumber: "SC-2024-00048", caseType: CaseType.APPEAL, status: CaseStatus.APPEAL_IN_PROGRESS,
      priority: Priority.URGENT, claimedPercentage: 60, hasMissingDocuments: true, isOverdue: true,
      assignedAgentIndex: 0, submissionDeadline: "2026-07-06", nextFollowUpDate: "2026-07-04",
    },
    {
      fullName: "עמית רוזן", nationalId: "135792468", dateOfBirth: "1983-08-08", gender: Gender.MALE,
      phone: "050-1234000", addressCity: "מודיעין", employmentStatus: EmploymentStatus.UNEMPLOYED,
      primaryCondition: "פגיעת ראש", recognizedPercentage: 15,
      caseNumber: "SC-2024-00335", caseType: CaseType.MOBILITY_ALLOWANCE, status: CaseStatus.NEW_INTAKE,
      priority: Priority.MEDIUM, hasMissingDocuments: true,
    },
    {
      fullName: "חנה שפירא", nationalId: "246813579", dateOfBirth: "1948-03-19", gender: Gender.FEMALE,
      phone: "052-8877665", addressCity: "בני ברק", employmentStatus: EmploymentStatus.RETIRED,
      primaryCondition: "דמנציה", recognizedPercentage: 70,
      caseNumber: "SC-2024-00312", caseType: CaseType.LONG_TERM_CARE, status: CaseStatus.GATHERING_DOCUMENTS,
      priority: Priority.HIGH, hasMissingDocuments: true, assignedAgentIndex: 0, nextFollowUpDate: "2026-07-12",
    },
  ];

  for (const m of mockData) {
    const client = await prisma.client.upsert({
      where: { nationalId: m.nationalId },
      update: {},
      create: {
        fullName: m.fullName,
        nationalId: m.nationalId,
        dateOfBirth: new Date(m.dateOfBirth),
        gender: m.gender,
        phone: m.phone,
        email: m.email,
        addressCity: m.addressCity,
        employmentStatus: m.employmentStatus,
        monthlyIncome: m.monthlyIncome,
        primaryCondition: m.primaryCondition,
        recognizedPercentage: m.recognizedPercentage,
      },
    });

    const assignedAgentId =
      m.assignedAgentIndex !== undefined ? agents[m.assignedAgentIndex].id : null;

    await prisma.case.upsert({
      where: { caseNumber: m.caseNumber },
      update: {},
      create: {
        caseNumber: m.caseNumber,
        clientId: client.id,
        assignedAgentId,
        createdById: admin.id,
        caseType: m.caseType,
        status: m.status,
        priority: m.priority,
        claimedPercentage: m.claimedPercentage,
        claimDescription: m.claimDescription,
        hasMissingDocuments: m.hasMissingDocuments,
        isOverdue: m.isOverdue ?? false,
        submissionDeadline: m.submissionDeadline ? new Date(m.submissionDeadline) : undefined,
        nextFollowUpDate: m.nextFollowUpDate ? new Date(m.nextFollowUpDate) : undefined,
        statusHistory: {
          create: { changedById: admin.id, previousStatus: null, newStatus: CaseStatus.NEW_INTAKE },
        },
      },
    });
  }

  console.log(`✅ ${mockData.length} mock clients & cases created`);
  console.log("🎉 Seed completed successfully!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
