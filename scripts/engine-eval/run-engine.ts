// scripts/engine-eval/run-engine.ts
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runExtraction } from "@/lib/rap/pipeline";
import type { EngineKey, RunResult } from "./types";

const engine = process.argv[2] as EngineKey;
if (!["bda", "textract", "textlayer"].includes(engine)) {
  throw new Error(`usage: run-engine.ts <bda|textract|textlayer> — got "${engine}"`);
}
// Fail fast on missing env for the chosen engine.
const need = engine === "bda"
  ? ["EXTRACTION_IMPL", "BEDROCK_REGION", "RAP_UPLOAD_BUCKET", "BDA_PROJECT_ARN", "BDA_PROFILE_ARN", "BDA_OUTPUT_BUCKET"]
  : ["EXTRACTION_IMPL", "DOC_LOADER", "BEDROCK_REGION", "RAP_UPLOAD_BUCKET"];
for (const k of need) if (!process.env[k]) throw new Error(`missing env ${k} for engine ${engine}`);

const resultsDir = resolve(__dirname, "results");

async function main() {
  const manifest = JSON.parse(await readFile(join(resultsDir, "manifest.json"), "utf8")) as {
    docs: { key: string; fileName: string; sourceS3Key: string }[];
  };
  for (const doc of manifest.docs) {
    const started = Date.now();
    let result: RunResult;
    try {
      const r = await runExtraction({ fileName: doc.fileName, sourceS3Key: doc.sourceS3Key });
      result = {
        engine, docKey: doc.key, fileName: doc.fileName, sourceS3Key: doc.sourceS3Key,
        timingMs: Date.now() - started, extracted: r.extracted, validationIssues: r.validationIssues,
        engineLabel: r.engine, error: null,
      };
      console.log(`✅ ${engine}/${doc.key}: ${r.extracted.commitments.length} commitments in ${result.timingMs}ms`);
    } catch (e) {
      result = {
        engine, docKey: doc.key, fileName: doc.fileName, sourceS3Key: doc.sourceS3Key,
        timingMs: Date.now() - started, extracted: null, validationIssues: [], engineLabel: engine,
        error: e instanceof Error ? e.message : String(e),
      };
      console.error(`❌ ${engine}/${doc.key}: ${result.error}`);
    }
    const dir = join(resultsDir, doc.key);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${engine}.json`), JSON.stringify(result, null, 2));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
