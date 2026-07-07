// Nations extraction (spec 2026-07-07). Same discipline as figures/summarizer: the
// model returns the Indigenous PARTY nation(s); a mechanical verifier keeps a name
// only if it appears verbatim (normWs) in the style of cause or the judgment text.
// Fill-if-empty only — curated nations are authoritative and never overwritten.
import type { CaseChunk, LegalCase } from "../types";
import type { LlmModel } from "./llm";
import { assembleInput, normWs } from "./summarizer";

export type NationsStatus = "generated" | "skipped_not_core" | "skipped_has_nations" | "skipped_no_fulltext" | "failed";
export interface NationsResult { status: NationsStatus; nations: string[] }

const MAX_NATIONS = 5;

export function parseNations(raw: string): string[] | null {
  const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const arr = (JSON.parse(raw.slice(start, end + 1)) as { nations?: unknown })?.nations;
    if (!Array.isArray(arr)) return null;
    return arr.map((n) => String(n ?? "")).filter(Boolean);
  } catch { return null; }
}

// Keep a name only if it appears verbatim (normWs, case-insensitive) in the style of
// cause or the judgment text. Dedupe case-insensitively (first surface form wins);
// cap at MAX_NATIONS. A name the model invents cannot survive.
export function verifyNations(names: string[], styleOfCause: string, chunks: CaseChunk[]): string[] {
  const hay = normWs([styleOfCause, ...chunks.map((c) => c.text)].join(" ")).toLowerCase();
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const name = raw.trim();
    if (name.length < 3) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    if (!hay.includes(normWs(name).toLowerCase())) continue; // not in the record → drop
    seen.add(key); out.push(name);
    if (out.length >= MAX_NATIONS) break;
  }
  return out;
}

export function buildNationsPrompt(c: LegalCase, body: string): string {
  return `You identify the Indigenous party in a Canadian court decision.

Case: ${c.styleOfCause}, ${c.citation} (${c.court}, ${c.year})

Return STRICTLY this JSON (no markdown, no commentary):
{"nations":["..."]}

Rules:
- List ONLY the Indigenous nation(s), band(s), tribal council(s), or Métis/Inuit group(s) that are a PARTY to THIS case (applicant/appellant/plaintiff/respondent) — usually named in the style of cause above.
- Copy each name VERBATIM as written (e.g. "Tsilhqot'in Nation", "Mikisew Cree First Nation", "Osoyoos Indian Band").
- Do NOT include nations that are only cited, referenced, or mentioned as precedent.
- Do NOT invent, translate, abbreviate, or normalize. If none is identifiable, return {"nations":[]}.

JUDGMENT TEXT:
${body}`;
}

export const NATIONS_RETRY_SUFFIX = "\n\nYour previous output was not valid JSON. Output ONLY the JSON object.";

export async function extractNations(c: LegalCase, model: LlmModel): Promise<NationsResult> {
  if (c.corpusTier !== "core") return { status: "skipped_not_core", nations: [] };
  if (c.nations.length > 0) return { status: "skipped_has_nations", nations: [] };
  if (!c.chunks || c.chunks.length === 0) return { status: "skipped_no_fulltext", nations: [] };
  const prompt = buildNationsPrompt(c, assembleInput(c.chunks, c.outcome.holding));
  let names = parseNations(await model.call(prompt));
  if (!names) names = parseNations(await model.call(prompt + NATIONS_RETRY_SUFFIX));
  if (!names) return { status: "failed", nations: [] };
  return { status: "generated", nations: verifyNations(names, c.styleOfCause, c.chunks) };
}
