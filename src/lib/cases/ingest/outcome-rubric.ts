// The outcome rubric IS the methodology — versioned and committed, like rubric.ts.
//
// WINDOWING: labelPrompt takes text.slice(0, 6000) — the HEAD of a judgment. That is
// correct for themes (stated early) and exactly wrong for outcome: the disposition
// ("the appeal is allowed") is at the END. This module spends the same 6000-character
// budget head+tail so the classifier always sees the operative sentence.
import type { CaseChunk, OutcomeDerivation, OutcomeType, WinType } from "../types";

export const OUTCOME_RUBRIC_VERSION = "2026-07-31.1";

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

export type Direction = "prevailed" | "did_not_prevail" | "partly";

// The mover prevailed iff what they sought was granted. Relative to the INDIGENOUS
// party, that flips whenever the mover is not the Indigenous party.
export function impliedDirection(d: OutcomeDerivation): Direction {
  if (d.granted === "partly") return "partly";
  return (d.granted === "granted") === d.movingPartyIsIndigenous ? "prevailed" : "did_not_prevail";
}

// True when a label cannot be reconciled with the reasoning that produced it. Exactly
// two such pairings exist; everything else is defensible.
//
// doctrine_win is exempt on purpose: it MEANS "the specific relief was refused but the
// principle advanced" (Haida is precisely this), so it can never contradict a
// did-not-prevail derivation. That makes it the one label this gate cannot check, which
// is why the labeler always flags it for review.
export function contradictsDerivation(winType: WinType, d: OutcomeDerivation): boolean {
  if (winType === "unclassified" || winType === "mixed" || winType === "doctrine_win") return false;
  const dir = impliedDirection(d);
  if (dir === "partly") return false;
  return dir === "prevailed" ? winType === "loss" : winType === "party_win";
}

export interface RawOutcome {
  winType: WinType;
  outcomeType: OutcomeType;
  derivation: OutcomeDerivation | null;
}

export const ALL_GRANTED = ["granted", "refused", "partly"] as const;

export function outcomePrompt(styleOfCause: string, chunks: CaseChunk[]): string {
  const wins = ALL_WINTYPES.map((k) => `- ${k}: ${WINTYPE_RUBRIC[k]}`).join("\n");
  const types = ALL_OUTCOMETYPES.map((k) => `- ${k}: ${OUTCOMETYPE_RUBRIC[k]}`).join("\n");
  return `You classify the OUTCOME of Canadian legal cases involving Indigenous parties.\n\n` +
    `Work in this order:\n` +
    `1. Identify the MOVING PARTY — who brought this proceeding (appellant / applicant / plaintiff).\n` +
    `   Do NOT infer this from the style of cause. A case named "X v. Y" is often brought by Y.\n` +
    `2. movingPartyIsIndigenous: is that moving party an Indigenous nation, band, or council?\n` +
    `3. granted: was what the moving party sought "granted", "refused", or "partly" given?\n` +
    `4. winType: relative to the INDIGENOUS party — NOT the moving party.\n\n` +
    `CRITICAL: if the Indigenous party was the moving party and its application was DISMISSED or ` +
    `REFUSED, the Indigenous party did NOT win. Never read "application dismissed" as a favourable ` +
    `result without first establishing who brought it.\n\n` +
    `winType is ALWAYS relative to the Indigenous party or interest; where no Indigenous party is ` +
    `involved, answer "unclassified" — never "loss". A purely procedural advance is NOT a victory.\n\n` +
    `Return ONLY this JSON object and no prose:\n` +
    `{"movingPartyIsIndigenous": true|false, "granted": "granted"|"refused"|"partly", ` +
    `"winType": "...", "outcomeType": "..."}\n\n` +
    `rubric ${OUTCOME_RUBRIC_VERSION}\n\nwinType:\n${wins}\n\noutcomeType:\n${types}\n\n` +
    dispositionWindow(styleOfCause, chunks);
}

// Tolerant of prose around the JSON. An absent or malformed derivation yields null
// rather than throwing — the caller decides what an underivable answer is worth.
export function parseOutcome(raw: string): RawOutcome {
  try {
    const o = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    // Normalize before the membership test. Strictness here must fail SAFE, not open:
    // an unrecognized value used to yield derivation=null, which the labeler read as
    // "consistent", silently disabling the very check this branch exists to perform.
    const rawMine = o?.movingPartyIsIndigenous;
    const mine = typeof rawMine === "boolean" ? rawMine
      : rawMine === "true" ? true
      : rawMine === "false" ? false
      : null;
    const g = typeof o?.granted === "string" ? o.granted.trim().toLowerCase() : "";
    const derivation: OutcomeDerivation | null =
      mine !== null && (ALL_GRANTED as readonly string[]).includes(g)
        ? { movingPartyIsIndigenous: mine, granted: g as OutcomeDerivation["granted"] }
        : null;
    return {
      winType: ALL_WINTYPES.includes(o?.winType) ? o.winType : "unclassified",
      outcomeType: ALL_OUTCOMETYPES.includes(o?.outcomeType) ? o.outcomeType : "unclassified",
      derivation,
    };
  } catch {
    return { winType: "unclassified", outcomeType: "unclassified", derivation: null };
  }
}
