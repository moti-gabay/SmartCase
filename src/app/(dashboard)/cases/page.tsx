import { CasesView } from "@/components/cases/cases-view";
import { getCases } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function CasesPage() {
  const cases = await getCases();
  return <CasesView cases={cases} />;
}
