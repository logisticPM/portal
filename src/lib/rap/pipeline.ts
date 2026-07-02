// THE EXTRACTION SEAM — actions import runExtraction from here and never know
// which engine ran. Default = in-process mock (no AWS); set EXTRACTION_IMPL=
// bedrock to use the real Claude-on-Bedrock pipeline. The bedrock module is
// dynamically imported so its SDK dependency never loads in mock/dev.
import type { ExtractionResult } from "./types";
import { runExtraction as runExtractionMock } from "./pipeline.mock";

export async function runExtraction(input: { fileName: string; sourceS3Key: string }): Promise<ExtractionResult> {
  const impl = process.env.EXTRACTION_IMPL;
  if (impl === "bda") {
    const { runExtractionBda } = await import("./pipeline.bda");
    return runExtractionBda(input);
  }
  if (impl === "bedrock") {
    const { runExtractionBedrock } = await import("./pipeline.bedrock");
    return runExtractionBedrock(input);
  }
  return runExtractionMock(input);
}
