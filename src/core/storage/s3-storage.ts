// Native Cloudflare R2 access via AWS SigV4 - zero external dependencies.
// Uses only node:crypto (HMAC-SHA256) and the global fetch. Server-only.
//
// R2 specifics vs plain AWS S3:
//   - endpoint host is the account endpoint: {accountId}.r2.cloudflarestorage.com
//   - path-style addressing: the bucket goes in the path (/{bucket}/{key})
//   - the signing region is the literal "auto"
//   - browser-direct uploads use a presigned PUT URL (R2 does not support the
//     POST-policy "POST Object" form upload), so size/type are validated
//     server-side at confirm time via HeadObject.
import crypto from "node:crypto";

const SERVICE = "s3";
const REGION = "auto"; // R2 always signs with region "auto"
const ALGORITHM = "AWS4-HMAC-SHA256";
const EMPTY_SHA256 = crypto.createHash("sha256").update("").digest("hex");

export const MAX_UPLOAD_SIZE = 10 * 1024 * 1024; // 10 MB
export const ALLOWED_MIME = ["application/pdf", "image/png", "image/jpeg", "image/jpg"] as const;

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID ?? "";
export const R2_BUCKET = process.env.R2_BUCKET ?? "";
const R2_HOST = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

function creds(): { accessKeyId: string; secretAccessKey: string } {
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey || !R2_ACCOUNT_ID || !R2_BUCKET) {
    throw new Error("Cloudflare R2 is not configured (R2_ACCOUNT_ID / R2_BUCKET / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY)");
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
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  return hmac(kService, "aws4_request");
}

// RFC3986 encoding (encodeURIComponent leaves !*'() unescaped; AWS wants them escaped).
const rfc3986 = (str: string): string =>
  encodeURIComponent(str).replace(/[!*'()]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
// Encode an object key for a URL path: encode each segment, keep the "/" separators.
const encodeKey = (key: string): string => key.split("/").map(rfc3986).join("/");
// Path-style object URI: /{bucket}/{key}
const objectUri = (key: string): string => `/${rfc3986(R2_BUCKET)}/${encodeKey(key)}`;

function stamps(): { amzDate: string; dateStamp: string } {
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, ""); // 20260705T123456Z
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

// Shared query-string signer for presigned GET/PUT URLs (host-only signed headers).
function presignUrl(method: "GET" | "PUT", key: string, extraParams: Record<string, string>, expiresIn: number): string {
  const { accessKeyId, secretAccessKey } = creds();
  const { amzDate, dateStamp } = stamps();
  const credential = `${accessKeyId}/${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const canonicalUri = objectUri(key);

  const params: Record<string, string> = {
    "X-Amz-Algorithm": ALGORITHM,
    "X-Amz-Credential": credential,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresIn),
    "X-Amz-SignedHeaders": "host",
    ...extraParams,
  };

  const canonicalQuery = Object.keys(params)
    .sort()
    .map((k) => `${rfc3986(k)}=${rfc3986(params[k])}`)
    .join("&");

  const canonicalHeaders = `host:${R2_HOST}\n`;
  const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const scope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = [ALGORITHM, amzDate, scope, sha256hex(canonicalRequest)].join("\n");
  const signature = hmac(signingKey(secretAccessKey, dateStamp), stringToSign).toString("hex");

  return `https://${R2_HOST}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

// Presigned PUT — browser uploads the file directly as the request body.
// The client sends `Content-Type: <mimeType>`; size/type are enforced at confirm time
// (R2 has no POST-policy, so we validate via HeadObject after upload). contentType is
// accepted for API symmetry but not signed (host-only), which keeps the PUT robust.
export function presignUpload(key: string, _contentType?: string, expiresIn = 300): { url: string } {
  return { url: presignUrl("PUT", key, {}, expiresIn) };
}

// Presigned GET — short-lived download URL that forces inline view + filename.
export function presignDownload(key: string, fileName: string | null, mimeType: string | null, expiresIn = 300): string {
  const extra: Record<string, string> = {
    "response-content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(fileName ?? "document")}`,
  };
  if (mimeType) extra["response-content-type"] = mimeType;
  return presignUrl("GET", key, extra, expiresIn);
}

// SigV4 header-signed request (DELETE / HEAD, empty body)
async function signedRequest(method: "DELETE" | "HEAD", key: string): Promise<Response> {
  const { accessKeyId, secretAccessKey } = creds();
  const { amzDate, dateStamp } = stamps();
  const canonicalUri = objectUri(key);
  const canonicalHeaders = `host:${R2_HOST}\nx-amz-content-sha256:${EMPTY_SHA256}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [method, canonicalUri, "", canonicalHeaders, signedHeaders, EMPTY_SHA256].join("\n");
  const scope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = [ALGORITHM, amzDate, scope, sha256hex(canonicalRequest)].join("\n");
  const signature = hmac(signingKey(secretAccessKey, dateStamp), stringToSign).toString("hex");
  const authorization = `${ALGORITHM} Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return fetch(`https://${R2_HOST}${canonicalUri}`, {
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
    throw new Error(`R2 delete failed (${res.status}) for ${key}`);
  }
}

// Returns null if the object does not exist, else its size + content type.
export async function headObject(key: string): Promise<{ contentLength: number; contentType: string | null } | null> {
  const res = await signedRequest("HEAD", key);
  if (res.status !== 200) return null;
  return {
    contentLength: Number(res.headers.get("content-length") ?? "0"),
    contentType: res.headers.get("content-type"),
  };
}

export async function objectExists(key: string): Promise<boolean> {
  return (await headObject(key)) !== null;
}
