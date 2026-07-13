// Server-only email dispatch (Resend). Every export is resilient by design:
// a missing API key, missing recipient, or network failure results in a silent
// no-op + log — never a thrown error — so a mail problem can never break the
// business action that triggered it.
import { Resend } from "resend";
import { prisma } from "@/lib/prisma";
import { portalDict, type PortalLocale } from "@/lib/i18n/conversion-portal";

// Lazy client so the module loads without RESEND_API_KEY (dev / CI).
let _resend: Resend | null = null;
function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

// Resend requires a verified sender in production; the shared sandbox address
// works out of the box for local testing.
const FROM = process.env.RESEND_FROM || "SmartCase <onboarding@resend.dev>";

function baseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "").replace(/\/$/, "");
}

// The client's portal language is not persisted yet, so we default to Hebrew
// (the office's primary language). Isolated as a resolver so a future
// `Client.locale` column can feed it without touching call sites.
function resolveLocale(): PortalLocale {
  return "he";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Notify the client that a document was rejected, in their language, with a
// direct link back to the secure portal wizard so they can re-upload.
export async function sendDocumentRejectionEmail(
  caseId: string,
  documentName: string,
  reviewNotes: string,
): Promise<void> {
  try {
    const resend = getResend();
    if (!resend) return; // not configured → no-op

    const c = await prisma.case.findUnique({
      where: { id: caseId },
      select: {
        clientPortalToken: true,
        client: { select: { fullName: true, email: true } },
      },
    });

    const email = c?.client.email;
    const token = c?.clientPortalToken;
    // No recipient or no secure link → nothing safe to send.
    if (!c || !email || !token) return;

    const locale = resolveLocale();
    const t = portalDict[locale];
    const dir = locale === "he" ? "rtl" : "ltr";
    const link = `${baseUrl()}/share/conversion/${token}`;

    const html = `<div dir="${dir}" style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.7;color:#0f172a;">
  <p>${t.emailGreeting} ${escapeHtml(c.client.fullName)},</p>
  <p>${t.emailRejectIntro}</p>
  <p style="font-weight:bold;margin:8px 0;">${escapeHtml(documentName)}</p>
  <p style="margin:8px 0;"><strong>${t.emailReasonLabel}:</strong> ${escapeHtml(reviewNotes)}</p>
  <p style="margin:24px 0;">
    <a href="${link}" style="background:#4f46e5;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:8px;display:inline-block;font-weight:bold;">${t.emailRejectCta}</a>
  </p>
  <p style="color:#64748b;margin-top:24px;">${t.emailSignature}</p>
</div>`;

    await resend.emails.send({
      from: FROM,
      to: email,
      subject: t.emailRejectSubject,
      html,
    });
  } catch (err) {
    // Absolute resilience: swallow everything so the caller is never affected.
    console.error("[notifications:sendDocumentRejectionEmail]", err);
  }
}
