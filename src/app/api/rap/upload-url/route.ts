// Issues a presigned S3 PUT URL so the browser uploads a RAP document directly
// to S3 (bypassing the Lambda 6 MB request limit). When S3 isn't configured
// (local/mock dev) it returns { configured: false } and the upload form falls
// back to the filename-only mock path.
import { NextResponse } from "next/server";
import { isUploadConfigured, presignUpload } from "@/lib/rap/storage";

export async function POST(req: Request) {
  if (!isUploadConfigured()) {
    return NextResponse.json({ configured: false });
  }
  const { fileName } = await req.json().catch(() => ({ fileName: "" }));
  const name = String(fileName ?? "").trim();
  if (!name) return NextResponse.json({ error: "fileName required" }, { status: 400 });

  const docId = globalThis.crypto.randomUUID();
  const { url, s3Key } = await presignUpload(docId, name);
  return NextResponse.json({ configured: true, url, s3Key });
}
