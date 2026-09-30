import { NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireStaffSession();
  if ("denied" in guard) return guard.denied;

  const { id } = await params;
  await prisma.generatedLetter.deleteMany({ where: { id } });
  return NextResponse.json({ ok: true });
}
