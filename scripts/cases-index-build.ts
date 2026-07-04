// Build the search-index artifacts from the CURRENT table (run at pipeline end —
// after ingest / fetch-fulltext / embed / promote). Writes local files always;
// uploads to S3 when INDEX_BUCKET is set. Spec 2026-07-03.
import "./fetch-polyfill";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getSearchIndex } from "../src/lib/cases/search/build-index";
import { buildArtifacts } from "../src/lib/cases/search/artifact";

const OUT_DIR = path.join(process.cwd(), "scripts", ".cache", "index");
export const BM25_KEY = `cases-index/v1/bm25.bin`;
export const VECTORS_KEY = `cases-index/v1/vectors.bin`;

async function main() {
  // Guard against circularity: the builder must ALWAYS scan the table, never load a
  // previously-built artifact (INDEX_FILE/INDEX_BUCKET may be exported in the shell).
  // Remember the upload target, then clear both envs before getSearchIndex runs.
  const bucket = process.env.INDEX_BUCKET;
  delete process.env.INDEX_FILE;
  delete process.env.INDEX_BUCKET;
  const idx = await getSearchIndex(true); // force a fresh scan — artifact must reflect the table NOW
  const { bm25, vectors, buildId } = buildArtifacts({ units: idx.units, cases: idx.cases, embedderId: idx.embedderId, vdim: idx.vdim });
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, "bm25.bin"), bm25);
  if (vectors) await fs.writeFile(path.join(OUT_DIR, "vectors.bin"), vectors);
  console.log(`✅ built artifacts buildId=${buildId} · bm25=${(bm25.length / 1e6).toFixed(1)}MB · vectors=${vectors ? (vectors.length / 1e6).toFixed(1) + "MB" : "none"} → ${OUT_DIR}`);

  if (bucket) {
    const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
    const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-east-1" });
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: BM25_KEY, Body: bm25 }));
    if (vectors) await s3.send(new PutObjectCommand({ Bucket: bucket, Key: VECTORS_KEY, Body: vectors }));
    console.log(`✅ uploaded to s3://${bucket}/${BM25_KEY}${vectors ? " (+vectors)" : ""}`);
  }
}
main().catch((e) => { console.error("❌ cases-index-build failed:", e); process.exit(1); });
