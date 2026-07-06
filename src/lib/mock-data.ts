import type { CaseSummary, DashboardStats, AlertItem } from "@/types";

export const MOCK_STATS: DashboardStats = {
  totalActiveCases:    87,
  missingDocsCases:    34,
  overdueCases:         8,
  submittedThisMonth:  12,
  approvedThisMonth:    5,
  newCasesThisWeek:     6,
};

export const MOCK_CASES: CaseSummary[] = [
   {
    id: "c1", caseNumber: "SC-2024-00341", clientId: "cl1",
    clientName: "שרה כהן", caseType: "DISABILITY_PENSION",
    status: "NEW_INTAKE", priority: "HIGH",
    assignedAgentName: "מגי לוי",
    hasMissingDocuments: true, isOverdue: false, missingDocsCount: 3,
    nextFollowUpDate: "2024-12-05", submissionDeadline: null,
    createdAt: "2024-11-20T10:00:00Z", updatedAt: "2024-11-28T09:00:00Z",
  }
];

export const MOCK_ALERTS: AlertItem[] = [
  {
    id: "a1", caseNumber: "SC-2024-00289", clientName: "משה לוי",
    type: "missing_docs", severity: "high", caseId: "c2",
    message: "5 מסמכים חסרים – תיק הוגדר כדחוף",
  }
]
