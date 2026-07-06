import { ConversionPortalView } from "@/components/portal/conversion-portal-view";
import { getPortalCaseByToken } from "@/lib/queries";

export const dynamic = "force-dynamic";

// Header, footer, branding, and the invalid-link state all now live inside
// ConversionPortalView — they need to be locale-reactive (language switcher +
// dir/lang toggle), which requires client-side state that a server component
// like this page can't own.
export default async function ConversionPortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const caseView = await getPortalCaseByToken(token);

  return <ConversionPortalView token={token} caseView={caseView} />;
}
