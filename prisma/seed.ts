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

  // ── Document Checklist Templates (CONVERSION) ──────────────────────────────
  const conversionDocs = [
    { documentType: DocumentType.NATIONAL_ID,       displayName: "תעודת זהות",              isMandatory: true,  sortOrder: 1 },
    { documentType: DocumentType.RABBI_LETTER,      displayName: "מכתב המלצה מרב",          isMandatory: true,  sortOrder: 2 },
    { documentType: DocumentType.COMMUNITY_LETTER,  displayName: "מכתב המלצה מהקהילה",      isMandatory: true,  sortOrder: 3 },
    { documentType: DocumentType.FAMILY_PHOTO,      displayName: "תמונה משפחתית",           isMandatory: false, sortOrder: 4 },
  ];

  for (const doc of conversionDocs) {
    await prisma.documentChecklistTemplate.upsert({
      where: { caseType_documentType: { caseType: CaseType.CONVERSION, documentType: doc.documentType } },
      update: {},
      create: { caseType: CaseType.CONVERSION, ...doc },
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
    }
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
