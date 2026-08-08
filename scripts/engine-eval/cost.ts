// scripts/engine-eval/cost.ts
import type { EngineKey } from "./types";

const SONNET_IN = 3 / 1_000_000;    // $/token
const SONNET_OUT = 15 / 1_000_000;
const TEXTRACT_PER_PAGE = 0.004;
const BDA_PER_PAGE = 0.040;         // custom blueprint (spec §8.1)

export function estimateCost(engine: EngineKey, pages: number, inTokens: number, outTokens: number): number {
  if (engine === "bda") return pages * BDA_PER_PAGE;
  const llm = inTokens * SONNET_IN + outTokens * SONNET_OUT;
  const textract = engine === "textract" ? pages * TEXTRACT_PER_PAGE : 0;
  return llm + textract;
}
