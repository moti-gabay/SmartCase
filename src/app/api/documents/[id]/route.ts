import { NextResponse } from "next/server";
import { auth } from "@/../auth";
import { prisma } from "@/lib/prisma";
import { presignDownload } from "@/core/storage/s3-storage";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }

  const { id } = await params;
  const meta = await prisma.document.findUnique({
    where: { id },
    select: { storageKey: true, mimeType: true, fileName: true },
  });
  if (!meta) return NextResponse.json({ error: "המסמך לא נמצא" }, { status: 404 });

  // S3-backed: redirect to a short-lived presigned GET URL (bytes never touch the function).
  if (meta.storageKey) {
    const url = presignDownload(meta.storageKey, meta.fileName, meta.mimeType);
    return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "private, no-store" } });
  }

  // Legacy fallback: stream bytes stored in Postgres (documents uploaded before the S3 migration).
  const legacy = await prisma.document.findUnique({ where: { id }, select: { fileData: true, mimeType: true, fileName: true } });
  if (!legacy?.fileData) return NextResponse.json({ error: "המסמך לא נמצא" }, { status: 404 });

  const bytes = new Uint8Array(legacy.fileData);
  const asciiName = encodeURIComponent(legacy.fileName ?? "document");
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "Content-Type": legacy.mimeType ?? "application/octet-stream",
      "Content-Disposition": `inline; filename*=UTF-8''${asciiName}`,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}
