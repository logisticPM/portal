// Dual-LLM outcome classification. Merge rule: EXACT AGREEMENT OR ABSTAIN, per field.
// No superclass collapsing, no tie-breaking, no third model — an `unclassified` row is
// a known gap, whereas a wrong `party_win` is a false claim in a client-facing count.
import type { CaseChunk, OutcomeMeta, OutcomeType, WinType } from "../types";
import { cachedCall, configuredModels, type LlmModel } from "./llm";
import { OUTCOME_RUBRIC_VERSION, outcomePrompt, parseOutcome, type RawOutcome } from "./outcome-rubric";

export interface ClassifiedOutcome {
  winType: WinType;
  outcomeType: OutcomeType;
  outcomeMeta: OutcomeMeta;
}

export function mergeOutcome(a: RawOutcome, b: RawOutcome, models: [string, string]): ClassifiedOutcome {
  const winAgrees = a.winType === b.winType;
  const typeAgrees = a.outcomeType === b.outcomeType;
  const winType: WinType = winAgrees ? a.winType : "unclassified";
  const outcomeType: OutcomeType = typeAgrees ? a.outcomeType : "unclassified";

  const matches = (winAgrees ? 1 : 0) + (typeAgrees ? 1 : 0);
  const agreement: OutcomeMeta["agreement"] = matches === 2 ? "full" : matches === 1 ? "partial" : "none";
  // Two models both answering "unclassified" agree, but that is not a confident
  // classification — hence the second clause.
  const confidence: OutcomeMeta["confidence"] =
    agreement === "full" && winType !== "unclassified" ? "high" : "low";

  return {
    winType,
    outcomeType,
    outcomeMeta: {
      method: "dual_llm", models, agreement, confidence,
      needsReview: agreement !== "full",
      rubricVersion: OUTCOME_RUBRIC_VERSION,
    },
  };
}

async function classifyWithModel(m: LlmModel, prompt: string): Promise<RawOutcome> {
  return parseOutcome(await cachedCall(m, prompt));
}

export async function classifyOutcome(
  styleOfCause: string, chunks: CaseChunk[], models?: [LlmModel, LlmModel],
): Promise<ClassifiedOutcome> {
  const [m1, m2] = models ?? configuredModels();
  const prompt = outcomePrompt(styleOfCause, chunks);
  const [a, b] = await Promise.all([classifyWithModel(m1, prompt), classifyWithModel(m2, prompt)]);
  return mergeOutcome(a, b, [m1.id, m2.id]);
}
