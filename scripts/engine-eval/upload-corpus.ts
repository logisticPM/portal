// scripts/engine-eval/upload-corpus.ts
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { CORPUS } from "./corpus";

const bucket = process.env.RAP_UPLOAD_BUCKET;
if (!bucket) throw new Error("RAP_UPLOAD_BUCKET not set");
const samplesDir = resolve(process.env.RAP_SAMPLES_DIR ?? "../CS7980/Week 7/rap_samples");
const region = process.env.AWS_REGION ?? process.env.BEDROCK_REGION ?? "ca-central-1";
const outDir = resolve(__dirname, "results");

async function main() {
  const s3 = new S3Client({ region });
  const docs: { key: string; fileName: string; sourceS3Key: string }[] = [];
  for (const doc of CORPUS) {
    const body = await readFile(join(samplesDir, doc.fileName));
    const sourceS3Key = `engine-eval/${doc.fileName}`;
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: sourceS3Key, Body: body, ContentType: "application/pdf" }));
    console.log(`uploaded ${doc.key} → s3://${bucket}/${sourceS3Key}`);
    docs.push({ key: doc.key, fileName: doc.fileName, sourceS3Key });
  }
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "manifest.json"), JSON.stringify({ uploadedAt: new Date().toISOString(), bucket, docs }, null, 2));
  console.log(`\nmanifest → ${join(outDir, "manifest.json")}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
