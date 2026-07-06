import { test, before } from "node:test";
import assert from "node:assert/strict";

// The module reads R2_* from the environment at import time — set them first.
process.env.R2_ACCOUNT_ID = "acc123";
process.env.R2_BUCKET = "smartcase-documents";
process.env.R2_ACCESS_KEY_ID = "AKIDTEST";
process.env.R2_SECRET_ACCESS_KEY = "SECRETTESTVALUE1234567890";

type S3 = typeof import("../src/core/storage/s3-storage");
let s3: S3;

before(async () => {
  s3 = await import("../src/core/storage/s3-storage");
});

test("constants: 10MB cap and the allowed mime list", () => {
  assert.equal(s3.MAX_UPLOAD_SIZE, 10 * 1024 * 1024);
  assert.deepEqual([...s3.ALLOWED_MIME], ["application/pdf", "image/png", "image/jpeg", "image/jpg"]);
});

test("sanitizeFileName strips path separators and unsafe chars, keeps unicode", () => {
  assert.match(s3.sanitizeFileName('דו"ח רפואי.pdf'), /^[\p{L}\p{N}._-]+$/u);
  assert.ok(s3.sanitizeFileName('דו"ח רפואי.pdf').endsWith(".pdf"));
  assert.ok(!s3.sanitizeFileName("../../etc/passwd").includes("/"));
  assert.ok(!s3.sanitizeFileName("a\\b\\c.png").includes("\\"));
  assert.equal(s3.sanitizeFileName(""), "document");
});

test("buildStorageKey namespaces by case and document id", () => {
  assert.equal(s3.buildStorageKey("c1", "d1", "report.pdf"), "cases/c1/d1/report.pdf");
});

test("presignUpload returns a PUT URL to the R2 path-style endpoint, signed with region auto", () => {
  const { url } = s3.presignUpload(s3.buildStorageKey("c1", "d1", "report.pdf"), "application/pdf");
  assert.ok(url.startsWith("https://acc123.r2.cloudflarestorage.com/smartcase-documents/cases/c1/d1/"));
  assert.ok(url.includes("X-Amz-Signature="), "must be signed");
  assert.ok(url.includes("%2Fauto%2Fs3%2Faws4_request"), "region must be 'auto'");
  assert.ok(url.includes("X-Amz-Expires="));
});

test("presignDownload forces inline disposition and is signed", () => {
  const url = s3.presignDownload("cases/c1/d1/report.pdf", "report.pdf", "application/pdf");
  assert.ok(url.includes("response-content-disposition"));
  assert.ok(url.includes("X-Amz-Signature="));
  assert.ok(url.startsWith("https://acc123.r2.cloudflarestorage.com/smartcase-documents/"));
});

test("signatures differ by key and are 64 hex chars", () => {
  const a = s3.presignUpload("cases/c1/d1/a.pdf", "application/pdf").url;
  const b = s3.presignUpload("cases/c1/d1/b.pdf", "application/pdf").url;
  const sigA = a.split("X-Amz-Signature=")[1];
  const sigB = b.split("X-Amz-Signature=")[1];
  assert.notEqual(sigA, sigB, "different keys must yield different signatures");
  assert.match(sigA, /^[0-9a-f]{64}$/, "signature is 64 hex chars");
});
