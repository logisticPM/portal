// Rung 3 of the citation-verification ladder, as a MEASUREMENT probe — not product code.
//
// The ladder (BigLaw's, and the frame this project adopted): rung 1 exact quote match,
// rung 2 tolerant match, rung 3 a paraphrase/entailment judge, rung 4 an ensemble.
// verifyClaims (ingest/summarizer.ts) is rungs 1-2. This module exists to answer ONE
// question with data instead of intuition: if we built rung 3, what would it buy?
//
// Deliberately a 3-way NLI task, NOT the eval judge's 4-way faithfulness task. Asking the
// same question twice in the same shape and calling the agreement "validation" would be
// circular. NLI is the standard framing in the literature this probe is checking against
// (SummaC / AlignScore / MiniCheck all reduce faithfulness to premise-hypothesis pairs),
// and its labels do not line up 1:1 with the judge's — which is the point. "overstated"
// has no NLI counterpart, and where it lands is the interesting result.

export type NliLabel = "entailment" | "neutral" | "contradiction";
const LABELS: readonly NliLabel[] = ["entailment", "neutral", "contradiction"];

function firstJson(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(raw.slice(start, end + 1));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch { return null; }
}

// null means THE CHECKER FAILED. Same discipline as parseVerdict: never default to a
// label, because a parse failure defaulted to "neutral" would read as the detector
// declining to flag — evidence about the product manufactured out of a broken response.
export function parseNliLabel(raw: string): NliLabel | null {
  const j = firstJson(raw);
  const v = typeof j?.label === "string" ? j.label.trim().toLowerCase() : "";
  return (LABELS as readonly string[]).includes(v) ? (v as NliLabel) : null;
}

export function buildNliPrompt(premise: string, hypothesis: string): string {
  return `Natural language inference. Decide the relationship between a premise and a hypothesis.

PREMISE:
${premise}

HYPOTHESIS:
${hypothesis}

Choose exactly one label:
- "entailment" — the premise makes the hypothesis true.
- "contradiction" — the premise makes the hypothesis false.
- "neutral" — the premise neither establishes nor refutes the hypothesis.

Judge ONLY from the premise. Do not use outside legal knowledge. A hypothesis that is true
in the world but not established by this premise is "neutral", not "entailment".

Output STRICTLY this JSON, no markdown:
{"label":"entailment|neutral|contradiction"}`;
}

// Arm 2. Only 5 of 264 judged claims are CONTRADICTED, and that scarcity is structural —
// the answerer rarely reverses the court outright, so no amount of re-running produces a
// powered natural sample. Manufacturing negations from claims the judge already called
// SUPPORTED gives a known-contradiction set of arbitrary size, at the cost that a minimal
// lexical reversal is EASIER to detect than a naturally-occurring one. Recall measured
// here is therefore an upper bound, and every report of it must say so.
export function buildReversalPrompt(sentence: string): string {
  return `Rewrite one sentence so that it asserts the OPPOSITE of what it currently asserts.

SENTENCE:
${sentence}

Requirements:
- Keep the same topic, vocabulary, length, and register.
- Change as little as possible — reverse the proposition, not the subject matter.
- Do NOT use "it is not true that", "contrary to", or any meta-commentary.
- Do NOT hedge. The result must be a flat assertion, like the original.
- Output the rewritten sentence only.

Output STRICTLY this JSON, no markdown:
{"reversed":"..."}`;
}

// A reversal that comes back identical, empty, or hedged into a non-assertion is a FAILED
// construction, not a hard case: including it would count a checker's "neutral" against
// the detector when the fault was ours. Callers drop these and report the drop count.
export function parseReversal(raw: string, original: string): string | null {
  const j = firstJson(raw);
  const v = typeof j?.reversed === "string" ? j.reversed.trim() : "";
  if (v.length < 20) return null;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (norm(v) === norm(original)) return null;
  if (/^(it is not true|contrary to|the opposite)/i.test(v)) return null;
  return v;
}
