import { AiToolsView } from "@/components/ai/ai-tools-view";
import { getCaseOptions } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function AiToolsPage() {
  const cases = await getCaseOptions();
  return <AiToolsView cases={cases} />;
}
