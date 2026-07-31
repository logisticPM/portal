// AI plain-language case summaries (spec 2026-07-03). Pure + injectable: the
// model is passed in (tests use fakes; the batch runner wraps in the disk cache).
// Governance: every displayed claim is anchored to a verbatim quote that is
// mechanically verified against the judgment text; unverifiable claims are
// dropped; <2 surviving claims → no summary at all (宁缺毋滥).
import type { CaseChunk, CitationAnchor, CitationAnchored, LegalCase, SummaryMeta } from "../types";
import type { LlmModel } from "./llm";

export interface RawClaim { text: string; quote: string; paragraph: string }
export type SummarizeStatus =
  | "generated" | "skipped_curated" | "skipped_not_core" | "skipped_no_fulltext" | "failed";
export interface SummarizeResult {
  status: SummarizeStatus;
  summary?: CitationAnchored;
  meta?: SummaryMeta;
  claimsDropped: number; // claims returned by the model but not kept (failed verification or past the 6 cap)
  drops?: ClaimDrop[];
}

// Fold typographic punctuation the model may ASCII-fy when emitting JSON.
// Applied symmetrically to quote and source, so it can never admit a quote
// whose letters/digits differ — it only rescues honest punctuation drops.
export const normWs = (s: string) =>
  s.replace(/[‘’‛]/g, "'")
   .replace(/[“”]/g, '"')
   .replace(/[‐-―−]/g, "-")
   .replace(/\s+/g, " ").trim();

// Parse the model's response: first "{" to last "}", strict shape check.
// Returns null on any malformation (caller retries once with a corrective suffix).
export function parseClaims(raw: string): RawClaim[] | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(raw.slice(start, end + 1));
    const arr = (obj as { claims?: unknown })?.claims;
    if (!Array.isArray(arr)) return null;
    // Non-object entries become empty claims so they flow into verifyClaims,
    // fail verification there, and get counted in `dropped`.
    return arr.map((c) => {
      if (!c || typeof c !== "object") return { text: "", quote: "", paragraph: "" };
      const r = c as Record<string, unknown>;
      return { text: String(r.text ?? ""), quote: String(r.quote ?? ""), paragraph: String(r.paragraph ?? "") };
    });
  } catch { return null; }
}

// Mechanical verification: the quote must appear verbatim (whitespace- and
// typographic-punctuation-normalized) somewhere in the judgment text. The anchor
// records where the quote ACTUALLY lives — computed, not model-claimed: models
// frequently misattribute paragraph ids (measured 2026-07-05: strict cited-
// paragraph matching dropped half of all honest claims). Lookup order: the cited
// chunk (accepting a bare "N" for "para-N" — models drop the prefix), then any
// single chunk, then adjacent-chunk pairs (chunking splits paragraphs at ~2KB
// with no overlap, so long quotes can legitimately span a boundary; the anchor
// points at the first chunk of the pair). A quote found nowhere is dropped —
// fabrications still cannot pass. Paraphrase fidelity is human-spot-checked
// (spec Q3).
export type ClaimDropReason = "no_text" | "quote_too_short" | "no_span";

// Why a claim was dropped. Diagnostics only — nothing here changes what survives. `bestOverlap`
// is the question this exists to answer: does the model cite the RIGHT paragraph and merely garble
// the transcription (high overlap → span alignment could recover it), or did it genuinely
// paraphrase (low overlap → there is no span to align to and the drop was correct)? We could not
// tell before, because only the dropped COUNT is persisted.
export interface ClaimDrop {
  reason: ClaimDropReason;
  quoteLen: number;
  citedPara: string;
  citedParaFound: boolean;
  bestOverlap: number;
}

// Longest common contiguous substring length. Two-row DP: O(n·m) time, O(min(n,m)) space. Only
// ever runs on the drop path, on a quote of at most a few hundred chars against a ~2KB chunk.
export function longestCommonSubstringLen(a: string, b: string): number {
  if (!a || !b) return 0;
  const [s, t] = a.length <= b.length ? [a, b] : [b, a];
  let prev = new Uint32Array(s.length + 1);
  let cur = new Uint32Array(s.length + 1);
  let best = 0;
  for (let j = 1; j <= t.length; j++) {
    for (let i = 1; i <= s.length; i++) {
      cur[i] = s[i - 1] === t[j - 1] ? prev[i - 1] + 1 : 0;
      if (cur[i] > best) best = cur[i];
    }
    const swap = prev; prev = cur; cur = swap;
    cur.fill(0);
  }
  return best;
}

export function verifyClaims(
  claims: RawClaim[], chunks: CaseChunk[], sourceUrl: string,
): { anchors: CitationAnchor[]; dropped: number; drops: ClaimDrop[] } {
  // Preconditions: chunk ids are unique (chunkText assigns para-${i+1}; duplicates
  // would first-win under find), and ARRAY ORDER = CONTIGUOUS DOCUMENT ORDER
  // (chunkText splits sequentially, reassembleCase sorts by CHUNK#%04d SK) — the
  // adjacent-pair window's safety argument depends on it: joining chunks i,i+1
  // reconstructs real judgment text; joining non-adjacent chunks would not.
  const norm = chunks.map((ch) => ({ para: String(ch.paragraph), text: normWs(ch.text) }));
  const locate = (quote: string, citedPara: string): string | null => {
    const cited = norm.find((n) => n.para === citedPara || n.para === `para-${citedPara}`);
    if (cited && cited.text.includes(quote)) return cited.para;
    const holder = norm.find((n) => n.text.includes(quote));
    if (holder) return holder.para;
    for (let i = 0; i + 1 < norm.length; i++) {
      if ((norm[i].text + " " + norm[i + 1].text).includes(quote)) return norm[i].para;
    }
    return null;
  };
  const anchors: CitationAnchor[] = [];
  const drops: ClaimDrop[] = [];
  const record = (reason: ClaimDropReason, quote: string, citedPara: string) => {
    const cited = norm.find((n) => n.para === citedPara || n.para === `para-${citedPara}`);
    drops.push({
      reason, quoteLen: quote.length, citedPara, citedParaFound: !!cited,
      // Overlap is measured against the CITED paragraph only — that is exactly the hypothesis under
      // test ("right paragraph, wrong span"), and scanning every chunk per drop would be far too
      // slow for a 559-case batch.
      bestOverlap: reason === "no_span" && cited && quote.length
        ? longestCommonSubstringLen(quote, cited.text) / quote.length
        : 0,
    });
  };
  for (const cl of claims) {
    if (anchors.length >= 6) break; // keep the first 6 in model output order
    const quote = normWs(cl.quote ?? "");
    const text = (cl.text ?? "").trim();
    const citedPara = String(cl.paragraph ?? "");
    if (!text) { record("no_text", quote, citedPara); continue; }
    if (quote.length < 15) { record("quote_too_short", quote, citedPara); continue; }
    const para = locate(quote, citedPara);
    if (para !== null) anchors.push({ text, sourceParagraph: para, sourceUrl });
    else record("no_span", quote, citedPara);
  }
  return { anchors, dropped: claims.length - anchors.length, drops };
}

const ECON_RE = /compensation|damages|royalt|revenue|settlement|\$/i;

// Deterministic input assembly. Under budget: the whole judgment in document
// order. Over budget: keep (a) the first 10 chunks (facts/background), (b)
// chunks sharing tokens with the holding, (c) economic-keyword chunks, then
// fill remaining budget in document order; emit selected chunks in document order.
export function assembleInput(chunks: CaseChunk[], holding: string, budget = 240_000): string {
  const lines = chunks.map((ch) => `[para ${ch.paragraph}] ${ch.text}`);
  const total = lines.reduce((n, l) => n + l.length + 1, 0);
  if (total <= budget) return lines.join("\n");

  const holdTokens = (holding.toLowerCase().match(/[a-z]{4,}/g) ?? []).slice(0, 12);
  const picked = new Set<number>();
  chunks.forEach((ch, i) => {
    if (i < 10) { picked.add(i); return; }
    const low = ch.text.toLowerCase();
    if (holdTokens.some((t) => low.includes(t)) || ECON_RE.test(ch.text)) picked.add(i);
  });

  const chosen: number[] = [];
  let used = 0;
  const tryAdd = (i: number) => {
    const cost = lines[i].length + 1;
    if (used + cost > budget) return;
    chosen.push(i); used += cost;
  };
  for (let i = 0; i < chunks.length; i++) if (picked.has(i)) tryAdd(i);
  for (let i = 0; i < chunks.length; i++) if (!picked.has(i)) tryAdd(i);
  chosen.sort((a, b) => a - b);
  return chosen.map((i) => lines[i]).join("\n");
}

export function buildPrompt(c: LegalCase, body: string): string {
  return `You are writing a plain-language summary of a Canadian court decision for readers WITHOUT legal training (Indigenous community members, business advisors, policy staff).

Case: ${c.styleOfCause}, ${c.citation} (${c.court}, ${c.year})

Below is the judgment text as paragraphs, each tagged [para <id>].

Produce STRICTLY this JSON (no markdown, no commentary):
{"claims":[{"text":"...","quote":"...","paragraph":"..."}]}

Rules:
- 3 to 6 claims.
- Each "text": 1-2 plain-language sentences a non-lawyer understands. No legalese.
- Each "quote": a VERBATIM excerpt copied character-for-character from one paragraph below (at least 15 characters).
- Each "paragraph": the id from that paragraph's [para <id>] tag.
- Together the claims must cover: (1) what the dispute was about, (2) what the court decided, (3) the economic significance or consequences.
- Do not invent facts. Every claim must be supported by its quote.

JUDGMENT TEXT:
${body}`;
}

export const RETRY_SUFFIX = "\n\nYour previous output was not valid JSON. Output ONLY the JSON object.";

export async function summarizeCase(c: LegalCase, model: LlmModel): Promise<SummarizeResult> {
  if (c.summary) return { status: "skipped_curated", claimsDropped: 0 };
  if (c.corpusTier !== "core") return { status: "skipped_not_core", claimsDropped: 0 };
  if (!c.chunks || c.chunks.length === 0) return { status: "skipped_no_fulltext", claimsDropped: 0 };

  const prompt = buildPrompt(c, assembleInput(c.chunks, c.outcome.holding));
  let claims = parseClaims(await model.call(prompt));
  // Retry once with a corrective suffix — the suffix changes the disk-cache key,
  // so a cached malformed response can never be replayed as the "retry".
  if (!claims) claims = parseClaims(await model.call(prompt + RETRY_SUFFIX));
  if (!claims) return { status: "failed", claimsDropped: 0 };

  const { anchors, dropped, drops } = verifyClaims(claims, c.chunks, c.provenance.sourceUrl);
  if (anchors.length < 2) return { status: "failed", claimsDropped: dropped, drops };
  return {
    status: "generated",
    summary: { claims: anchors },
    meta: { method: "llm", model: model.id, generatedAt: new Date().toISOString(), claimsDropped: dropped },
    claimsDropped: dropped,
    drops,
  };
}
