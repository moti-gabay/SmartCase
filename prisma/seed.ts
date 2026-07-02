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
