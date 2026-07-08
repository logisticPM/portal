// Recorded economic figures (spec 2026-07-07). Same discipline as summarizer.ts:
// the model proposes figures with a verbatim quote + anchor; a mechanical verifier
// keeps a figure only if its amount parses deterministically AND its quote appears
// verbatim (whitespace/typography-normalized, re-anchored) in the judgment text.
// The model can never introduce a number that isn't in the judgment.
import type { CaseChunk, ExtractedFigure, FigureKind, FigureRole, FiguresMeta, LegalCase } from "../types";
import type { LlmModel } from "./llm";
import { assembleInput, normWs } from "./summarizer";

export interface RawFigure { raw: string; quote: string; paragraph: string; kind: string; role: string }
export type ExtractStatus = "generated" | "skipped_not_core" | "skipped_no_fulltext" | "failed";
export interface ExtractResult { status: ExtractStatus; figures?: ExtractedFigure[]; meta?: FiguresMeta; dropped: number }

const KINDS: FigureKind[] = ["settlement", "compensation", "damages", "resource_revenue", "equity", "other"];
const ROLES: FigureRole[] = ["awarded", "ordered", "claimed", "valuation", "contextual"];
const MAX_FIGURES = 12;

// Deterministic amount parser. Percent (equity) → { amount, unit:"percent" }.
// Monetary REQUIRES an explicit currency marker so bare numbers (years, section
// numbers, counts) are never treated as money. Unparseable → null (dropped).
export function parseAmount(raw: string): { amount: number; unit?: "percent" } | null {
  const s = raw.trim();
  const pct = s.match(/(\d[\d,]*(?:\.\d+)?)\s*%/);
  if (pct) { const n = Number(pct[1].replace(/,/g, "")); return Number.isFinite(n) ? { amount: n, unit: "percent" } : null; }
  if (!/\$|\bCAD\b|\bUSD\b|C\$|dollar/i.test(s)) return null;
  const m = s.match(/(\d[\d,]*(?:\.\d+)?)\s*(billion|million|thousand|bn|m|k)?/i);
  if (!m) return null;
  let n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const scale = (m[2] ?? "").toLowerCase();
  if (scale === "billion" || scale === "bn") n *= 1e9;
  else if (scale === "million" || scale === "m") n *= 1e6;
  else if (scale === "thousand" || scale === "k") n *= 1e3;
  return { amount: n };
}

// Parse the model's response: first "{" to last "}", strict shape check.
export function parseFigures(raw: string): RawFigure[] | null {
  const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const arr = (JSON.parse(raw.slice(start, end + 1)) as { figures?: unknown })?.figures;
    if (!Array.isArray(arr)) return null;
    return arr.map((f) => {
      const r = (f && typeof f === "object" ? f : {}) as Record<string, unknown>;
      return { raw: String(r.raw ?? ""), quote: String(r.quote ?? ""), paragraph: String(r.paragraph ?? ""),
        kind: String(r.kind ?? ""), role: String(r.role ?? "") };
    });
  } catch { return null; }
}

// Mechanical verification, mirroring summarizer.verifyClaims re-anchoring: the quote
// must appear verbatim (normWs) in the cited chunk, else any chunk, else an adjacent
// chunk pair (anchor = first of the pair). Amount must parse; quote must contain raw.
export function verifyFigures(
  raws: RawFigure[], chunks: CaseChunk[], sourceUrl: string,
): { figures: ExtractedFigure[]; dropped: number } {
  const norm = chunks.map((ch) => ({ para: String(ch.paragraph), text: normWs(ch.text) }));
  const locate = (quote: string, cited: string): string | null => {
    const c = norm.find((n) => n.para === cited || n.para === `para-${cited}`);
    if (c && c.text.includes(quote)) return c.para;
    const h = norm.find((n) => n.text.includes(quote));
    if (h) return h.para;
    for (let i = 0; i + 1 < norm.length; i++)
      if ((norm[i].text + " " + norm[i + 1].text).includes(quote)) return norm[i].para;
    return null;
  };
  const figures: ExtractedFigure[] = [];
  for (const rf of raws) {
    if (figures.length >= MAX_FIGURES) break;
    const parsed = parseAmount(rf.raw);
    if (!parsed) continue;
    const quote = normWs(rf.quote ?? "");
    if (!quote.includes(normWs(rf.raw))) continue;   // quote must actually contain the figure
    const para = locate(quote, String(rf.paragraph ?? ""));
    if (para === null) continue;                     // quote not found in judgment → drop
    const kind = (KINDS as string[]).includes(rf.kind) ? (rf.kind as FigureKind) : "other";
    const role = (ROLES as string[]).includes(rf.role) ? (rf.role as FigureRole) : "contextual";
    figures.push({
      raw: rf.raw, amount: parsed.amount,
      currency: /USD|US\$/i.test(rf.raw) ? "USD" : "CAD",
      ...(parsed.unit ? { unit: parsed.unit } : {}),
      kind, role, quote: rf.quote, sourceParagraph: para, sourceUrl,
    });
  }
  return { figures, dropped: raws.length - figures.length };
}

export function buildFigurePrompt(c: LegalCase, body: string): string {
  return `You extract monetary figures from a Canadian court decision. List EVERY monetary figure that literally appears in the text — settlement/compensation/damages amounts, resource revenue or royalties, and equity percentages.

Case: ${c.styleOfCause}, ${c.citation} (${c.court}, ${c.year})

Produce STRICTLY this JSON (no markdown, no commentary):
{"figures":[{"raw":"...","quote":"...","paragraph":"...","kind":"...","role":"..."}]}

Rules:
- "raw": the figure EXACTLY as written, copied character-for-character (e.g. "$30 million", "51%").
- "quote": a VERBATIM excerpt from one paragraph below that CONTAINS "raw".
- "paragraph": the id from that paragraph's [para <id>] tag.
- "kind": one of settlement | compensation | damages | resource_revenue | equity | other.
- "role": one of awarded | ordered (the court granted it) | claimed (a party sought it) | valuation (an appraisal) | contextual (merely mentioned).
- Do NOT infer, convert, sum, adjust, or invent any number. Copy only figures present in the text. If none, return {"figures":[]}.

JUDGMENT TEXT:
${body}`;
}

export const FIGURE_RETRY_SUFFIX = "\n\nYour previous output was not valid JSON. Output ONLY the JSON object.";

export async function extractFigures(c: LegalCase, model: LlmModel): Promise<ExtractResult> {
  if (c.corpusTier !== "core") return { status: "skipped_not_core", dropped: 0 };
  if (!c.chunks || c.chunks.length === 0) return { status: "skipped_no_fulltext", dropped: 0 };
  const prompt = buildFigurePrompt(c, assembleInput(c.chunks, c.outcome.holding));
  let raws = parseFigures(await model.call(prompt));
  if (!raws) raws = parseFigures(await model.call(prompt + FIGURE_RETRY_SUFFIX));
  if (!raws) return { status: "failed", dropped: 0 };
  const { figures, dropped } = verifyFigures(raws, c.chunks, c.provenance.sourceUrl);
  return {
    status: "generated", figures,
    meta: { method: "llm", model: model.id, generatedAt: new Date().toISOString(), dropped },
    dropped,
  };
}
