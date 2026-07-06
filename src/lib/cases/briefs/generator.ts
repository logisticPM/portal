// Briefing generation (spec 2026-07-05). Pure + injectable, mirroring the
// summarizer: model passed in, mechanical verification gates the output.
// Governance: the model may cite ONLY retrieved case ids — hallucinated ids are
// dropped; <2 surviving precedents → failed, no briefing (宁缺毋滥).
import type { LegalCase } from "../types";
import type { LlmModel } from "../ingest/llm";
import { RETRY_SUFFIX } from "../ingest/summarizer";
import type { BriefingBody, BriefPrecedent, BriefPrinciple } from "./types";

// Compact per-case context from PROFILE data only (holding + curated fields +
// AI-summary claim texts) — no chunks; ~3-5k tokens for 6 cases.
export function buildBriefContext(cases: LegalCase[]): string {
  return cases.map((c) => [
    `[case ${c.id}] ${c.styleOfCause}, ${c.citation} (${c.court}, ${c.year})`,
    c.themes.length ? `themes: ${c.themes.join(", ")}` : "",
    c.outcome.holding ? `holding: ${c.outcome.holding}` : "",
    c.economic?.economicSummary ? `economic: ${c.economic.economicSummary}` : "",
    c.summary?.claims.length ? `summary: ${c.summary.claims.map((cl) => cl.text).join(" ")}` : "",
  ].filter(Boolean).join(" · ")).join("\n");
}

export function buildBriefPrompt(question: string, context: string): string {
  return `You are preparing a briefing note for policy and business readers WITHOUT legal training, based ONLY on the Canadian court decisions provided below.

QUESTION: ${question}

Produce STRICTLY this JSON (no markdown, no commentary):
{"background":"...","precedents":[{"caseId":"...","establishes":"...","relevance":"..."}],"principles":[{"text":"...","caseIds":["..."]}],"considerations":"..."}

Rules:
- Cite ONLY case ids that appear as [case <id>] below. Never invent a case.
- 2 to 6 precedents. "establishes": what the decision established (1-2 plain sentences). "relevance": why it matters for the question (1 sentence).
- 1 to 4 principles: cross-case principles, each listing its supporting case ids.
- "considerations": 2-4 sentences on what these precedents mean for the question. Describe what the law establishes — do NOT give advice, recommendations, or predictions.
- Plain language. No legalese. No invented facts.

CASES:
${context}`;
}

// Parse: first "{" to last "}", strict shape check; null on any malformation.
export function parseBriefing(raw: string): BriefingBody | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const o = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    if (typeof o.background !== "string" || typeof o.considerations !== "string") return null;
    if (!Array.isArray(o.precedents) || !Array.isArray(o.principles)) return null;
    const precedents: BriefPrecedent[] = o.precedents
      .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
      .map((p) => ({ caseId: String(p.caseId ?? ""), establishes: String(p.establishes ?? ""), relevance: String(p.relevance ?? "") }));
    const principles: BriefPrinciple[] = o.principles
      .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
      .map((p) => ({ text: String(p.text ?? ""), caseIds: Array.isArray(p.caseIds) ? p.caseIds.map(String) : [] }));
    return { background: o.background, precedents, principles, considerations: o.considerations };
  } catch { return null; }
}

// Mechanical gate: only retrieved case ids survive; principles keep only valid
// ids and are dropped when none remain; <2 surviving precedents → null.
export function verifyBriefing(
  body: BriefingBody, retrievedIds: string[],
): { body: BriefingBody; dropped: number } | null {
  const valid = new Set(retrievedIds);
  const precedents = body.precedents
    .filter((p) => valid.has(p.caseId) && p.establishes.trim() && p.relevance.trim())
    .slice(0, 6);
  const principles = body.principles
    .map((pr) => ({ text: pr.text.trim(), caseIds: pr.caseIds.filter((id) => valid.has(id)) }))
    .filter((pr) => pr.text && pr.caseIds.length > 0);
  const dropped = (body.precedents.length - precedents.length) + (body.principles.length - principles.length);
  if (precedents.length < 2) return null;
  return { body: { ...body, precedents, principles }, dropped };
}

export type GenerateResult =
  | { status: "done"; body: BriefingBody; dropped: number }
  | { status: "failed"; failReason: string };

export async function generateBriefing(question: string, cases: LegalCase[], model: LlmModel): Promise<GenerateResult> {
  if (cases.length < 2) return { status: "failed", failReason: "not enough relevant cases found — try rephrasing" };
  const prompt = buildBriefPrompt(question, buildBriefContext(cases));
  let parsed = parseBriefing(await model.call(prompt));
  // Cache-safe retry: the suffix changes the disk-cache key (summarizer convention).
  if (!parsed) parsed = parseBriefing(await model.call(prompt + RETRY_SUFFIX));
  if (!parsed) return { status: "failed", failReason: "the model could not produce a verifiable briefing for this question" };
  const verified = verifyBriefing(parsed, cases.map((c) => c.id));
  if (!verified) return { status: "failed", failReason: "the model could not produce a verifiable briefing for this question" };
  return { status: "done", body: verified.body, dropped: verified.dropped };
}
