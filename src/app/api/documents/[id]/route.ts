import { NextResponse } from "next/server";
import { auth } from "@/../auth";
import { prisma } from "@/lib/prisma";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }

  const { id } = await params;
  const doc = await prisma.document.findUnique({
    where: { id },
    select: { fileData: true, mimeType: true, fileName: true },
  });

  if (!doc || !doc.fileData) {
    return NextResponse.json({ error: "המסמך לא נמצא" }, { status: 404 });
  }

  const bytes = new Uint8Array(doc.fileData);
  const asciiName = encodeURIComponent(doc.fileName ?? "document");

  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "Content-Type": doc.mimeType ?? "application/octet-stream",
      "Content-Disposition": `inline; filename*=UTF-8''${asciiName}`,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}
