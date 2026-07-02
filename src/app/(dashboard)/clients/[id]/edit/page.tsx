import { notFound } from "next/navigation";
import { ClientEditForm } from "@/components/clients/client-edit-form";
import { getClientDetail } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function ClientEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = await getClientDetail(id);
  if (!client) notFound();
  return <ClientEditForm client={client} />;
}
