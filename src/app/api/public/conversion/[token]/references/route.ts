import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { resolvePortalToken } from "@/lib/queries";

// PUBLIC, UNAUTHENTICATED. Add / update / remove the recommenders on a case
// (WIZARD_REFERENCES). Deliberately a Route Handler and NOT a "use server"
// action in src/lib/actions.ts: these mutations trust a caller-supplied row id,
// so they must never be exportable as a network-invokable Server Action.
//
// The trust rule, identical to the other public routes: the owning profile is
// derived from the token via resolvePortalToken(). A reference id from the body
// is only ever used inside a WHERE that is already pinned to that profile, so a
// crafted id belonging to another case matches zero rows and 404s.

const MAX_REFERENCES = 10;

const createSchema = z.object({
  // Honeypot field — must arrive empty. See conversion-portal-view.tsx.
  honeypot: z.string().optional(),
  fullName: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(1).max(40),
  role: z.string().trim().min(1).max(120),
  relationship: z.string().trim().max(200).optional(),
});

const updateSchema = createSchema.extend({ id: z.string().min(1) });
const deleteSchema = z.object({ id: z.string().min(1) });

const INVALID = "נתוני הטופס אינם תקינים";
const NOT_FOUND = "קישור לא תקין או שפג תוקפו";

// Resolves the token to the case's ConversionProfile id. The profile row is
// created lazily on first submit; a client who somehow reaches this step before
// that gets one created here rather than an error.
async function resolveProfileId(token: string): Promise<{ caseId: string; profileId: string } | null> {
  const resolved = await resolvePortalToken(token);
  if (!resolved) return null;
  const profile = await prisma.conversionProfile.upsert({
    where: { caseId: resolved.caseId },
    update: {},
    create: { caseId: resolved.caseId },
    select: { id: true },
  });
  return { caseId: resolved.caseId, profileId: profile.id };
}

function revalidateCase(caseId: string) {
  revalidatePath(`/cases/${caseId}`);
  revalidatePath("/cases");
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const owner = await resolveProfileId(token);
  if (!owner) return NextResponse.json({ error: NOT_FOUND }, { status: 404 });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: INVALID }, { status: 400 });
  const data = parsed.data;

  // Honeypot tripped — same generic message as a real validation failure so a
  // bot gets no signal it was specifically detected.
  if (data.honeypot) return NextResponse.json({ error: INVALID }, { status: 400 });

  try {
    const count = await prisma.conversionReference.count({
      where: { conversionProfileId: owner.profileId },
    });
    if (count >= MAX_REFERENCES) {
      return NextResponse.json({ error: "ניתן להוסיף עד 10 ממליצים", code: "TOO_MANY_REFERENCES" }, { status: 409 });
    }

    const created = await prisma.conversionReference.create({
      data: {
        conversionProfileId: owner.profileId,
        fullName: data.fullName,
        phone: data.phone,
        role: data.role,
        relationship: data.relationship || null,
      },
      select: { id: true, fullName: true, phone: true, role: true, relationship: true },
    });

    revalidateCase(owner.caseId);
    return NextResponse.json({ reference: created });
  } catch (err) {
    console.error("[public/conversion/references:POST]", err);
    return NextResponse.json({ error: "שמירת הממליץ נכשלה" }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const owner = await resolveProfileId(token);
  if (!owner) return NextResponse.json({ error: NOT_FOUND }, { status: 404 });

  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: INVALID }, { status: 400 });
  const data = parsed.data;
  if (data.honeypot) return NextResponse.json({ error: INVALID }, { status: 400 });

  try {
    // updateMany (not update) so the profile id is part of the WHERE: a row id
    // from another case simply matches nothing instead of being updated.
    const res = await prisma.conversionReference.updateMany({
      where: { id: data.id, conversionProfileId: owner.profileId },
      data: {
        fullName: data.fullName,
        phone: data.phone,
        role: data.role,
        relationship: data.relationship || null,
      },
    });
    if (res.count === 0) return NextResponse.json({ error: NOT_FOUND }, { status: 404 });

    revalidateCase(owner.caseId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[public/conversion/references:PATCH]", err);
    return NextResponse.json({ error: "עדכון הממליץ נכשל" }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const owner = await resolveProfileId(token);
  if (!owner) return NextResponse.json({ error: NOT_FOUND }, { status: 404 });

  const parsed = deleteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: INVALID }, { status: 400 });

  try {
    const res = await prisma.conversionReference.deleteMany({
      where: { id: parsed.data.id, conversionProfileId: owner.profileId },
    });
    if (res.count === 0) return NextResponse.json({ error: NOT_FOUND }, { status: 404 });

    revalidateCase(owner.caseId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[public/conversion/references:DELETE]", err);
    return NextResponse.json({ error: "מחיקת הממליץ נכשלה" }, { status: 500 });
  }
}
