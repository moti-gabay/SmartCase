import { ClientsView } from "@/components/clients/clients-view";
import { getClientList, getClientCities } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const [clients, cities] = await Promise.all([getClientList(), getClientCities()]);
  return <ClientsView clients={clients} cities={cities} />;
}
