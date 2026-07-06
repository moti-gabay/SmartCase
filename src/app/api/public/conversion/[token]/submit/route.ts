import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { resolvePortalToken } from "@/lib/queries";

// PUBLIC, UNAUTHENTICATED. caseId/clientId come ONLY from resolvePortalToken(token)
// — never from the request body — so a crafted request can only ever affect the
// single case its token belongs to. Identity fields (name, national ID) are
// deliberately NOT accepted here; only contact/family fields are client-editable.
const childSchema = z.object({
  fullName: z.string().min(1),
  dateOfBirth: z.string().optional(),
});

const submitSchema = z.object({
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  addressCity: z.string().optional(),
  spouseFullName: z.string().optional(),
  spouseNationalId: z.string().optional(),
  spouseReligion: z.string().optional(),
  communityName: z.string().optional(),
  sponsoringRabbi: z.string().optional(),
  courtName: z.string().optional(),
  additionalNotes: z.string().optional(),
  children: z.array(childSchema).max(20).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const resolved = await resolvePortalToken(token);
  if (!resolved) return NextResponse.json({ error: "קישור לא תקין או שפג תוקפו" }, { status: 404 });

  const parsed = submitSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "נתוני הטופס אינם תקינים" }, { status: 400 });
  const data = parsed.data;
  const { caseId, clientId } = resolved;

  try {
    await prisma.$transaction(async (tx) => {
      if (data.phone || data.email || data.addressCity) {
        await tx.client.update({
          where: { id: clientId },
          data: {
            ...(data.phone ? { phone: data.phone } : {}),
            ...(data.email ? { email: data.email } : {}),
            ...(data.addressCity ? { addressCity: data.addressCity } : {}),
          },
        });
      }

      const profileData = {
        spouseFullName: data.spouseFullName || null,
        spouseNationalId: data.spouseNationalId || null,
        spouseReligion: data.spouseReligion || null,
        communityName: data.communityName || null,
        sponsoringRabbi: data.sponsoringRabbi || null,
        courtName: data.courtName || null,
        additionalNotes: data.additionalNotes || null,
        submittedAt: new Date(),
      };

      const profile = await tx.conversionProfile.upsert({
        where: { caseId },
        update: profileData,
        create: { caseId, ...profileData },
        select: { id: true },
      });

      if (data.children) {
        await tx.conversionChild.deleteMany({ where: { conversionProfileId: profile.id } });
        if (data.children.length > 0) {
          await tx.conversionChild.createMany({
            data: data.children.map((c) => ({
              conversionProfileId: profile.id,
              fullName: c.fullName,
              dateOfBirth: c.dateOfBirth ? new Date(c.dateOfBirth) : null,
            })),
          });
        }
      }
    });

    revalidatePath(`/cases/${caseId}`);
    revalidatePath("/cases");
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[public/conversion/submit]", err);
    return NextResponse.json({ error: "שמירת הטופס נכשלה" }, { status: 500 });
  }
}
