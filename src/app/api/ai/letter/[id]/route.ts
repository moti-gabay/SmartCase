import { NextResponse } from "next/server";
import { auth } from "@/../auth";
import { prisma } from "@/lib/prisma";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "לא מורשה" }, { status: 401 });

  const { id } = await params;
  await prisma.generatedLetter.deleteMany({ where: { id } });
  return NextResponse.json({ ok: true });
}
