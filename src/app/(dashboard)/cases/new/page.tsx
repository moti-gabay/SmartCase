import { NewCaseForm } from "@/components/cases/new-case-form";
import { getClientOptions, getAgents } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function NewCasePage() {
  const [clients, agents] = await Promise.all([getClientOptions(), getAgents()]);
  return <NewCaseForm clients={clients} agents={agents} />;
}
