// The outcome rubric IS the methodology — versioned and committed, like rubric.ts.
//
// WINDOWING: labelPrompt takes text.slice(0, 6000) — the HEAD of a judgment. That is
// correct for themes (stated early) and exactly wrong for outcome: the disposition
// ("the appeal is allowed") is at the END. This module spends the same 6000-character
// budget head+tail so the classifier always sees the operative sentence.
import type { CaseChunk, OutcomeType, WinType } from "../types";

export const OUTCOME_RUBRIC_VERSION = "2026-07-30.1";

// winType is ALWAYS relative to the Indigenous party or interest.
export const WINTYPE_RUBRIC: Record<WinType, string> = {
  party_win: "The court granted the Indigenous party substantive relief — approval quashed, infringement declared, consultation ordered redone.",
  doctrine_win: "The specific relief was refused, but the legal principle advanced in the Indigenous party's favour.",
  loss: "Relief was refused, or the duty was found not triggered or already discharged.",
  mixed: "Substantive relief was granted in part and refused in part.",
  unclassified: "A purely procedural step (leave, standing, stay, extension, costs) with no substantive relief, or no Indigenous party or interest is involved.",
};

export const OUTCOMETYPE_RUBRIC: Record<OutcomeType, string> = {
  precedent: "Resolves the merits and states a legal rule intended to govern future cases.",
  procedural: "Resolves a procedural step (leave, standing, stay, extension, costs) without deciding the merits.",
  remand: "Sends the matter back to a decision-maker or lower court for redetermination.",
  regulatory: "Reviews the decision of a regulator or tribunal (board, commission, ministerial authorization).",
  settlement: "Approves, interprets, or enforces a settlement agreement.",
  unclassified: "None of the above is the best fit.",
};

export const ALL_WINTYPES = Object.keys(WINTYPE_RUBRIC) as WinType[];
export const ALL_OUTCOMETYPES = Object.keys(OUTCOMETYPE_RUBRIC) as OutcomeType[];

const HEAD_CHARS = 2000;
const TAIL_CHARS = 4000;

const render = (c: CaseChunk) => `${c.paragraph}: ${c.text}`;

// Head + tail, tail-weighted. Invariant: the FINAL paragraph is always present —
// a final paragraph longer than the budget keeps its end, not its start.
export function dispositionWindow(styleOfCause: string, chunks: CaseChunk[]): string {
  const header = `[CASE] ${styleOfCause}`;
  if (chunks.length === 0) return `${header}\n\n[FULL TEXT]\n(no paragraphs available)`;

  const lines = chunks.map(render);
  const total = lines.reduce((n, s) => n + s.length + 1, 0);
  if (total <= HEAD_CHARS + TAIL_CHARS) {
    return `${header}\n\n[FULL TEXT]\n${lines.join("\n")}`;
  }

  // Tail first, and never empty: the disposition is why this function exists.
  let tailStart = lines.length - 1;
  let used = lines[tailStart].length;
  while (tailStart > 0 && used + lines[tailStart - 1].length + 1 <= TAIL_CHARS) {
    used += lines[tailStart - 1].length + 1;
    tailStart--;
  }
  const tailLines = lines.slice(tailStart);
  // Re-prepend the id: the reviewer locates the disposition by paragraph number, and
  // slicing the tail would otherwise eat the "para-N: " prefix.
  if (tailLines[0].length > TAIL_CHARS) {
    tailLines[0] = `${chunks[tailStart].paragraph}: …${tailLines[0].slice(-TAIL_CHARS)}`;
  }

  let headEnd = 0;
  used = 0;
  while (headEnd < tailStart && used + lines[headEnd].length + 1 <= HEAD_CHARS) {
    used += lines[headEnd].length + 1;
    headEnd++;
  }
  // A first paragraph larger than the head budget keeps its START — the mirror of the
  // tail rule. Dropping the opening outright would lose who the parties are, and
  // winType is defined relative to the Indigenous party, so that loss is not survivable.
  const truncatedHead = headEnd === 0;
  const headLines = truncatedHead ? [lines[0].slice(0, HEAD_CHARS) + "…"] : lines.slice(0, headEnd);

  const omitted = tailStart - (truncatedHead ? 1 : headEnd);
  const parts = [header, ""];
  if (headLines.length > 0) parts.push("[OPENING]", headLines.join("\n"), "");
  if (omitted > 0) parts.push(`[... ${omitted} paragraph${omitted === 1 ? "" : "s"} omitted ...]`, "");
  parts.push("[DISPOSITION]", tailLines.join("\n"));
  return parts.join("\n");
}

const DISPOSITION_RE = /\b(allow|dismiss|grant|quash|set aside|declare|remit)\w*\b/i;

// The last sentence in the last paragraph that reads like a disposition. Sentence
// splitting is crude on purpose — the reviewer also sees the paragraph id and can
// pull the full window when a line looks wrong.
export function dispositionSentence(chunks: CaseChunk[]): string | null {
  for (let i = chunks.length - 1; i >= 0; i--) {
    const sentences = chunks[i].text.split(/(?<=[.!?])\s+/);
    for (let j = sentences.length - 1; j >= 0; j--) {
      if (DISPOSITION_RE.test(sentences[j])) return sentences[j].trim();
    }
  }
  return null;
}

export function outcomePrompt(styleOfCause: string, chunks: CaseChunk[]): string {
  const wins = ALL_WINTYPES.map((k) => `- ${k}: ${WINTYPE_RUBRIC[k]}`).join("\n");
  const types = ALL_OUTCOMETYPES.map((k) => `- ${k}: ${OUTCOMETYPE_RUBRIC[k]}`).join("\n");
  return `You classify the OUTCOME of Canadian legal cases involving Indigenous parties. ` +
    `Read the disposition and decide who prevailed. winType is ALWAYS relative to the Indigenous ` +
    `party or interest; if there is no Indigenous party, answer "unclassified" — never "loss". ` +
    `A purely procedural advance is NOT a victory. Pick the single best fit for each field. ` +
    `Return ONLY a JSON object {"winType": "...", "outcomeType": "..."} and no prose.\n\n` +
    `rubric ${OUTCOME_RUBRIC_VERSION}\n\nwinType:\n${wins}\n\noutcomeType:\n${types}\n\n` +
    dispositionWindow(styleOfCause, chunks);
}

export interface RawOutcome { winType: WinType; outcomeType: OutcomeType }

// Tolerant of prose around the JSON, same as parseThemes. Anything unrecognized
// degrades to "unclassified" rather than throwing.
export function parseOutcome(raw: string): RawOutcome {
  try {
    const o = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    return {
      winType: ALL_WINTYPES.includes(o?.winType) ? o.winType : "unclassified",
      outcomeType: ALL_OUTCOMETYPES.includes(o?.outcomeType) ? o.outcomeType : "unclassified",
    };
  } catch {
    return { winType: "unclassified", outcomeType: "unclassified" };
  }
}
