// Native AWS S3 access via SigV4 - zero external dependencies.
// Uses only node:crypto (HMAC-SHA256) and the global fetch. Server-only.
//
// - presignUpload:   browser-direct upload via a presigned POST policy
//                    (enforces content-type + size at S3; bytes never touch the function)
// - presignDownload: short-lived presigned GET URL (query signing)
// - deleteObject / objectExists: SigV4 header-signed DELETE / HEAD
import crypto from "node:crypto";

const SERVICE = "s3";
const ALGORITHM = "AWS4-HMAC-SHA256";
const EMPTY_SHA256 = crypto.createHash("sha256").update("").digest("hex");

export const MAX_UPLOAD_SIZE = 10 * 1024 * 1024; // 10 MB
export const ALLOWED_MIME = ["application/pdf", "image/png", "image/jpeg", "image/jpg"] as const;

export const S3_BUCKET = process.env.AWS_S3_BUCKET ?? "";
export const S3_REGION = process.env.AWS_REGION ?? "";
const S3_HOST = `${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com`;

function creds(): { accessKeyId: string; secretAccessKey: string } {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey || !S3_BUCKET || !S3_REGION) {
    throw new Error("AWS S3 is not configured (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_S3_BUCKET / AWS_REGION)");
  }
  return { accessKeyId, secretAccessKey };
}

// SigV4 primitives
const hmac = (key: crypto.BinaryLike, data: string): Buffer =>
  crypto.createHmac("sha256", key).update(data, "utf8").digest();
const sha256hex = (data: string): string =>
  crypto.createHash("sha256").update(data, "utf8").digest("hex");

function signingKey(secret: string, dateStamp: string): Buffer {
  const kDate = hmac(`AWS4${secret}`, dateStamp);
  const kRegion = hmac(kDate, S3_REGION);
  const kService = hmac(kRegion, SERVICE);
  return hmac(kService, "aws4_request");
}

// RFC3986 encoding (encodeURIComponent leaves !*'() unescaped; AWS wants them escaped).
const rfc3986 = (str: string): string =>
  encodeURIComponent(str).replace(/[!*'()]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
// Encode an object key for a URL path: encode each segment, keep the "/" separators.
const encodeKey = (key: string): string => key.split("/").map(rfc3986).join("/");

function stamps(): { amzDate: string; dateStamp: string } {
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, ""); // 20260703T123456Z
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

// Key helpers
export function sanitizeFileName(name: string): string {
  const base = (name || "document")
    .replace(/[/\\]/g, "_")
    .replace(/[^\p{L}\p{N}._-]+/gu, "_") // keep unicode letters/digits, dot, underscore, hyphen
    .replace(/_+/g, "_")
    .replace(/^[._]+|[._]+$/g, "");
  return (base || "document").slice(0, 180);
}

export function buildStorageKey(caseId: string, documentId: string, fileName: string): string {
  return `cases/${caseId}/${documentId}/${sanitizeFileName(fileName)}`;
}

// Presigned POST (browser-direct upload)
export function presignUpload(
  key: string,
  contentType: string
): { url: string; fields: Record<string, string> } {
  const { accessKeyId, secretAccessKey } = creds();
  const { amzDate, dateStamp } = stamps();
  const credential = `${accessKeyId}/${dateStamp}/${S3_REGION}/${SERVICE}/aws4_request`;
  const expiration = new Date(Date.now() + 120_000).toISOString(); // 2 minutes

  const policy = {
    expiration,
    conditions: [
      { bucket: S3_BUCKET },
      { key },
      { "Content-Type": contentType },
      ["content-length-range", 1, MAX_UPLOAD_SIZE],
      { "x-amz-algorithm": ALGORITHM },
      { "x-amz-credential": credential },
      { "x-amz-date": amzDate },
    ],
  };

  const policyBase64 = Buffer.from(JSON.stringify(policy)).toString("base64");
  const signature = hmac(signingKey(secretAccessKey, dateStamp), policyBase64).toString("hex");

  return {
    url: `https://${S3_HOST}/`,
    fields: {
      key,
      "Content-Type": contentType,
      "x-amz-algorithm": ALGORITHM,
      "x-amz-credential": credential,
      "x-amz-date": amzDate,
      Policy: policyBase64,
      "x-amz-signature": signature,
    },
  };
}

// Presigned GET (query-string signing)
export function presignDownload(
  key: string,
  fileName: string | null,
  mimeType: string | null,
  expiresIn = 300
): string {
  const { accessKeyId, secretAccessKey } = creds();
  const { amzDate, dateStamp } = stamps();
  const credential = `${accessKeyId}/${dateStamp}/${S3_REGION}/${SERVICE}/aws4_request`;
  const canonicalUri = "/" + encodeKey(key);

  const params: Record<string, string> = {
    "X-Amz-Algorithm": ALGORITHM,
    "X-Amz-Credential": credential,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresIn),
    "X-Amz-SignedHeaders": "host",
  };
  if (mimeType) params["response-content-type"] = mimeType;
  params["response-content-disposition"] = `inline; filename*=UTF-8''${encodeURIComponent(fileName ?? "document")}`;

  const canonicalQuery = Object.keys(params)
    .sort()
    .map((k) => `${rfc3986(k)}=${rfc3986(params[k])}`)
    .join("&");

  const canonicalHeaders = `host:${S3_HOST}\n`;
  const canonicalRequest = ["GET", canonicalUri, canonicalQuery, canonicalHeaders, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const scope = `${dateStamp}/${S3_REGION}/${SERVICE}/aws4_request`;
  const stringToSign = [ALGORITHM, amzDate, scope, sha256hex(canonicalRequest)].join("\n");
  const signature = hmac(signingKey(secretAccessKey, dateStamp), stringToSign).toString("hex");

  return `https://${S3_HOST}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

// SigV4 header-signed request (DELETE / HEAD, empty body)
async function signedRequest(method: "DELETE" | "HEAD", key: string): Promise<Response> {
  const { accessKeyId, secretAccessKey } = creds();
  const { amzDate, dateStamp } = stamps();
  const canonicalUri = "/" + encodeKey(key);
  const canonicalHeaders = `host:${S3_HOST}\nx-amz-content-sha256:${EMPTY_SHA256}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [method, canonicalUri, "", canonicalHeaders, signedHeaders, EMPTY_SHA256].join("\n");
  const scope = `${dateStamp}/${S3_REGION}/${SERVICE}/aws4_request`;
  const stringToSign = [ALGORITHM, amzDate, scope, sha256hex(canonicalRequest)].join("\n");
  const signature = hmac(signingKey(secretAccessKey, dateStamp), stringToSign).toString("hex");
  const authorization = `${ALGORITHM} Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return fetch(`https://${S3_HOST}${canonicalUri}`, {
    method,
    headers: {
      Authorization: authorization,
      "x-amz-content-sha256": EMPTY_SHA256,
      "x-amz-date": amzDate,
    },
  });
}

export async function deleteObject(key: string): Promise<void> {
  const res = await signedRequest("DELETE", key);
  if (!res.ok && res.status !== 404) {
    throw new Error(`S3 delete failed (${res.status}) for ${key}`);
  }
}

export async function objectExists(key: string): Promise<boolean> {
  const res = await signedRequest("HEAD", key);
  return res.status === 200;
}
