import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolvePortalToken } from "@/lib/queries";
import { isPortalLocale } from "@/lib/i18n/conversion-portal";

// PUBLIC, UNAUTHENTICATED. Persists the client's language choice so it survives
// a refresh and so automated mail reaches them in the same language.
//
// Deliberately a Route Handler and NOT an exported Server Action: this mutation
// must trust nothing from the caller, and a `"use server"` export that took a
// clientId would become network-invokable the moment it was imported into a
// client component. Here the trust boundary is unambiguous — `clientId` is
// resolved from the bearer token server-side, so possession of a link can only
// ever change that link's own client, and only among the three known locales.
//
// No honeypot: this fires on a UI toggle, not a form submit — there is no form
// for a bot to auto-fill, and the only reachable effect is flipping one's own
// display language. The public *forms* (/submit) keep theirs.
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const resolved = await resolvePortalToken(token);
  if (!resolved) return NextResponse.json({ error: "קישור לא תקין או שפג תוקפו" }, { status: 404 });

  try {
    const body = await req.json().catch(() => null);
    // Reject rather than coerce: an unknown locale from a caller is a bad
    // request, unlike a stale DB value which falls back to Hebrew.
    if (!isPortalLocale(body?.locale)) {
      return NextResponse.json({ error: "הטופס אינו תקין" }, { status: 400 });
    }

    await prisma.client.update({
      where: { id: resolved.clientId },
      data: { locale: body.locale },
    });

    return NextResponse.json({ locale: body.locale });
  } catch (err) {
    console.error("[public/conversion/locale]", err);
    return NextResponse.json({ error: "העדכון נכשל" }, { status: 500 });
  }
}
