// Dual-LLM merge (spec §5): only labels BOTH models agree on become themes.
// Inter-model agreement is a CONSISTENCY signal, not accuracy (§6 validates accuracy).
import type { Theme, ThemeLabelMeta } from "../types";
import { configuredModels, labelWithModel } from "./llm";
import { labelPrompt } from "./rubric";

export function mergeLabels(a: Theme[], b: Theme[], models: [string, string]): { themes: Theme[]; labelMeta: ThemeLabelMeta } {
  const sa = new Set(a), sb = new Set(b);
  const inter = [...sa].filter((t) => sb.has(t));
  const union = new Set([...a, ...b]);
  const agreement: ThemeLabelMeta["agreement"] =
    union.size === 0 ? "none" : inter.length === union.size ? "full" : inter.length > 0 ? "partial" : "none";
  const confidence = agreement === "full" ? "high" : "low";
  return {
    themes: inter,
    labelMeta: { method: "dual_llm", models, agreement, confidence, needsReview: agreement !== "full" },
  };
}

// Orchestration (live): label one case's text with both models, then merge.
export async function labelCase(text: string): Promise<{ themes: Theme[]; labelMeta: ThemeLabelMeta }> {
  const [m1, m2] = configuredModels();
  const prompt = labelPrompt(text);
  const [a, b] = await Promise.all([labelWithModel(m1, prompt), labelWithModel(m2, prompt)]);
  return mergeLabels(a, b, [m1.id, m2.id]);
}
