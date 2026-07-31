import { notFound } from "next/navigation";
import { CaseDetailView } from "@/components/cases/case-detail-view";
import { getCaseDetail, getAgents } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Agents feed the optional assignee select in the case-scoped new-task modal.
  const [caseDetail, agents] = await Promise.all([getCaseDetail(id), getAgents()]);
  if (!caseDetail) notFound();

  return <CaseDetailView caseDetail={caseDetail} agents={agents} />;
}
