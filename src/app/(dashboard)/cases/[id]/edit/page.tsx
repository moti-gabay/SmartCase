import { notFound } from "next/navigation";
import { CaseEditForm } from "@/components/cases/case-edit-form";
import { getCaseDetail, getAgents } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function CaseEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [caseDetail, agents] = await Promise.all([getCaseDetail(id), getAgents()]);
  if (!caseDetail) notFound();
  return <CaseEditForm caseDetail={caseDetail} agents={agents} />;
}
