// ===========================================================================
// S3 storage for raw RAP documents (RAP_UPLOAD_BUCKET). Server-only.
//
// The upload flow PUTs the file here (server-side, through the action — fine for
// capstone-size PDFs); the extraction pipeline GETs it back as bytes. When
// RAP_UPLOAD_BUCKET is unset (local/mock dev) storage is "not configured" and
// the upload action falls back to a synthesized key + the mock pipeline, so the
// demo runs with no AWS.
// ===========================================================================
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const bucket = process.env.RAP_UPLOAD_BUCKET;
const region = process.env.AWS_REGION ?? process.env.BEDROCK_REGION ?? "ca-central-1";

export const isUploadConfigured = () => !!bucket;

let _client: S3Client | null = null;
function client(): S3Client {
  if (!bucket) throw new Error("RAP_UPLOAD_BUCKET not set — S3 storage is not configured");
  return (_client ??= new S3Client({ region }));
}

// keep uploads namespaced + collision-free
export function uploadKey(docId: string, fileName: string): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return `uploads/${docId}/${safe}`;
}

export async function putDocument(s3Key: string, body: Uint8Array, contentType: string): Promise<void> {
  await client().send(
    new PutObjectCommand({ Bucket: bucket, Key: s3Key, Body: body, ContentType: contentType }),
  );
}

// Presigned PUT URL so the BROWSER uploads the file directly to S3, bypassing
// the Lambda 6 MB request limit (server-side upload only works for small files).
// ContentType is intentionally NOT signed, so the browser may set any — avoids
// signature mismatch. Returns the URL + the key to record on the job.
export async function presignUpload(docId: string, fileName: string): Promise<{ url: string; s3Key: string }> {
  const s3Key = uploadKey(docId, fileName);
  const url = await getSignedUrl(client(), new PutObjectCommand({ Bucket: bucket, Key: s3Key }), {
    expiresIn: 300,
  });
  return { url, s3Key };
}

export async function getDocumentBytes(s3Key: string): Promise<Uint8Array> {
  const res = await client().send(new GetObjectCommand({ Bucket: bucket, Key: s3Key }));
  // Body is a stream in Node; transformToByteArray is provided by the SDK v3 mixin
  return (res.Body as any).transformToByteArray();
}

// Generic reader for any s3://bucket/key URI (e.g. BDA writes its result JSON to
// the output bucket, which differs from the upload bucket). Reuses the region.
export function parseS3Uri(s3Uri: string): { bucket: string; key: string } {
  const m = s3Uri.match(/^s3:\/\/([^/]+)\/(.+)$/);
  if (!m) throw new Error(`not an s3:// uri: ${s3Uri}`);
  return { bucket: m[1], key: m[2] };
}

export async function getJsonByS3Uri<T = any>(s3Uri: string): Promise<T> {
  const { bucket: b, key } = parseS3Uri(s3Uri);
  const s3 = new S3Client({ region });
  const res = await s3.send(new GetObjectCommand({ Bucket: b, Key: key }));
  const text = await (res.Body as any).transformToString();
  return JSON.parse(text) as T;
}

export function contentTypeFor(fileName: string): string {
  const ext = fileName.toLowerCase().split(".").pop();
  if (ext === "pdf") return "application/pdf";
  if (ext === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (ext === "txt") return "text/plain";
  return "application/octet-stream";
}
