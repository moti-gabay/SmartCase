import { notFound } from "next/navigation";
import { ClientProfile } from "@/components/clients/client-profile";
import { getClientDetail } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function ClientProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = await getClientDetail(id);
  if (!client) notFound();
  return <ClientProfile client={client} />;
}
