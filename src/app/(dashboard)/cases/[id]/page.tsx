import { notFound } from "next/navigation";
import { CaseDetailView } from "@/components/cases/case-detail-view";
import { getCaseDetail } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const caseDetail = await getCaseDetail(id);
  if (!caseDetail) notFound();

  return <CaseDetailView caseDetail={caseDetail} />;
}
