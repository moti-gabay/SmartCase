import { NextResponse } from "next/server";
import { auth } from "@/../auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }

  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return NextResponse.json({ clients: [], cases: [] });
  }

  const [clients, cases] = await Promise.all([
    prisma.client.findMany({
      where: {
        OR: [
          { fullName: { contains: q, mode: "insensitive" } },
          { nationalId: { contains: q } },
          { phone: { contains: q } },
        ],
      },
      select: { id: true, fullName: true, nationalId: true },
      take: 6,
      orderBy: { fullName: "asc" },
    }),
    prisma.case.findMany({
      where: {
        OR: [
          { caseNumber: { contains: q, mode: "insensitive" } },
          { client: { fullName: { contains: q, mode: "insensitive" } } },
        ],
      },
      select: {
        id: true,
        caseNumber: true,
        caseType: true,
        status: true,
        client: { select: { fullName: true } },
      },
      take: 6,
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  return NextResponse.json({
    clients,
    cases: cases.map((c) => ({
      id: c.id,
      caseNumber: c.caseNumber,
      caseType: c.caseType,
      status: c.status,
      clientName: c.client.fullName,
    })),
  });
}
