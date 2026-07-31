// Dual-LLM outcome classification. Merge rule: EXACT AGREEMENT OR ABSTAIN, per field.
//
// Before any cross-model comparison, each response is checked against ITSELF: a model
// that says the Indigenous party moved, that its application was refused, and that the
// Indigenous party won has contradicted its own reasoning. Such a response is discarded
// rather than compared — it is the failure mode that produced wrong labels in the first
// pass, and it is invisible without the derivation.
import type { CaseChunk, OutcomeDerivation, OutcomeMeta, OutcomeType, WinType } from "../types";
import { cachedCall, configuredModels, type LlmModel } from "./llm";
import {
  OUTCOME_RUBRIC_VERSION, contradictsDerivation, outcomePrompt, parseOutcome, type RawOutcome,
} from "./outcome-rubric";

export interface ClassifiedOutcome {
  winType: WinType;
  outcomeType: OutcomeType;
  derivation?: OutcomeDerivation;
  outcomeMeta: OutcomeMeta;
}

// A response is usable only if it did not contradict itself. A missing derivation is
// NOT a contradiction — the model simply did not show its work.
const selfConsistent = (r: RawOutcome): boolean =>
  r.derivation === null || !contradictsDerivation(r.winType, r.derivation);

export function mergeOutcome(a: RawOutcome, b: RawOutcome, models: [string, string]): ClassifiedOutcome {
  const okA = selfConsistent(a), okB = selfConsistent(b);
  const contradictions = (okA ? 0 : 1) + (okB ? 0 : 1);

  // Discarded responses cannot agree with anything.
  if (!okA || !okB) {
    return {
      winType: "unclassified", outcomeType: "unclassified",
      outcomeMeta: {
        method: "dual_llm", models, agreement: "none", confidence: "low",
        needsReview: true, rubricVersion: OUTCOME_RUBRIC_VERSION, contradictions,
      },
    };
  }

  const winAgrees = a.winType === b.winType;
  const typeAgrees = a.outcomeType === b.outcomeType;
  const winType: WinType = winAgrees ? a.winType : "unclassified";
  const outcomeType: OutcomeType = typeAgrees ? a.outcomeType : "unclassified";

  const matches = (winAgrees ? 1 : 0) + (typeAgrees ? 1 : 0);
  const agreement: OutcomeMeta["agreement"] = matches === 2 ? "full" : matches === 1 ? "partial" : "none";
  const confidence: OutcomeMeta["confidence"] =
    agreement === "full" && winType !== "unclassified" ? "high" : "low";

  // doctrine_win is the one label contradictsDerivation cannot check, so it is never
  // left unreviewed.
  const needsReview = agreement !== "full" || winType === "doctrine_win";

  // Store the derivation only when both models produced the same one — a contested
  // derivation is not evidence of anything.
  const sameDerivation = a.derivation && b.derivation
    && a.derivation.movingPartyIsIndigenous === b.derivation.movingPartyIsIndigenous
    && a.derivation.granted === b.derivation.granted;

  return {
    winType, outcomeType,
    ...(sameDerivation ? { derivation: a.derivation! } : {}),
    outcomeMeta: {
      method: "dual_llm", models, agreement, confidence,
      needsReview, rubricVersion: OUTCOME_RUBRIC_VERSION, contradictions,
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
