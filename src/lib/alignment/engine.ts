// ===========================================================================
// Alignment engine — given a procurement commitment + the supplier pool, score
// each verified supplier on REAL signals (sector match + deterministic BM25
// capability relevance + verification tier + ownership), keep Top-N above the
// threshold, attach a fact-based rationale, and upsert Opportunity rows.
//
// Legitimacy: the score never depends on the stub embedder. Relevance is a real
// offline BM25 signal; a real embedder's cosine (EMBED_PROVIDER != stub) and a
// real LABEL_MODELS rationale are blended in ONLY when configured. Offline, the
// rationale is a deterministic sentence built from the same real facts — never a
// stub theme-array.
// ===========================================================================
import type { Commitment } from "../commitments/types";
import type { Supplier, Party } from "../repo/types";
import { getEmbedder, isRealProvider } from "../cases/search/embedder";
import { cachedModel, modelFromId } from "../cases/ingest/llm";
import { SECTOR_LABELS } from "../taxonomy";
import { TIER_LABELS } from "../repo/labels";
import { cosine, fitScore, THRESHOLD, TOP_N } from "./score";
import { bm25Relevance } from "./relevance";
import type { Opportunity, OpportunityRepo, OpportunityReasons } from "./types";
import { opportunityId } from "./types";

const NOW = () => new Date().toISOString();

function commitmentText(c: Commitment): string {
  return [c.title, c.detail, c.targetText].filter(Boolean).join(" · ");
}
function supplierText(s: Supplier): string {
  return [s.name, s.sector, s.blurb].filter(Boolean).join(" · ");
}
const isVerifiedSupplier = (s: Supplier) => s.identityTier === "nation" || s.identityTier === "ccib";

// Score one commitment against the pool; keep Top-N >= threshold; upsert; prune the rest.
export async function computeForCommitment(
  commitment: Commitment,
  pool: Party[],
  repo: OpportunityRepo,
): Promise<Opportunity[]> {
  if (commitment.type !== "procurement") return [];
  if (!commitment.orgId) return []; // opportunities are keyed by orgId (drives the company view); skip unattributed commitments
  const suppliers = pool.filter((p): p is Supplier => p.role === "supplier" && isVerifiedSupplier(p));
  if (suppliers.length === 0) return [];

  const cText = commitmentText(commitment);
  const supplierTexts = suppliers.map(supplierText);

  // Deterministic capability relevance (real, offline, zero-cost).
  const bm25 = bm25Relevance(cText, suppliers.map((s, i) => ({ id: s.id, text: supplierTexts[i] })));

  // Real embedding cosine ONLY when a real embedder is configured — never the stub.
  let semantic: (number | undefined)[] = suppliers.map(() => undefined);
  if (isRealProvider()) {
    const embedder = getEmbedder();
    const [commitVec, ...supVecs] = await embedder.embed([cText, ...supplierTexts]);
    semantic = suppliers.map((_, i) => Math.max(0, cosine(commitVec, supVecs[i])));
  }

  const scored: Opportunity[] = suppliers.map((s, i) => {
    const sectorMatch = !!s.sectorNorm && s.sectorNorm === commitment.sector;
    const sem = semantic[i];
    // Relevance used in the score = the stronger of BM25 (always) and the real
    // embedding cosine (when present). semantic is recorded separately for provenance.
    const relevance = sem !== undefined ? Math.max(bm25[i], sem) : bm25[i];
    const reasons: OpportunityReasons = {
      sectorMatch,
      relevance,
      identityTier: s.identityTier,
      ...(sem !== undefined ? { semantic: sem } : {}),
    };
    return {
      id: opportunityId(commitment.id, s.id),
      commitmentId: commitment.id,
      orgId: commitment.orgId as string,
      supplierId: s.id,
      supplierName: s.name,
      commitmentTitle: commitment.title,
      score: fitScore({ sectorMatch, relevance, identityTier: s.identityTier, ownershipPct: s.ownershipPct }),
      reasons,
      status: "new",
      createdAt: NOW(),
    };
  });

  const kept = scored.filter((o) => o.score >= THRESHOLD).sort((a, b) => b.score - a.score).slice(0, TOP_N);
  const keptIds = new Set(kept.map((o) => o.id));

  // Fact-based rationale (deterministic template offline; real model when wired).
  for (const o of kept) {
    const s = suppliers.find((x) => x.id === o.supplierId)!;
    o.rationale = await rationale(commitment, s, o.reasons);
    await repo.upsert(o);
  }
  // prune sub-threshold pairs that may have existed before for this commitment
  for (const o of scored) if (!keptIds.has(o.id)) await repo.remove(o.id);
  return kept;
}

// A real (non-stub) LABEL_MODELS phrasing when configured; otherwise — and on any
// error — a deterministic sentence from the real facts. NEVER routes a `stub:`
// model to the labeler (that returns a JSON theme-array, not a rationale).
async function rationale(c: Commitment, s: Supplier, reasons: OpportunityReasons): Promise<string> {
  const modelId = process.env.LABEL_MODELS?.split(",")[0]?.trim() ?? "";
  if (modelId && !modelId.startsWith("stub:")) {
    try {
      const model = cachedModel(modelFromId(modelId, { maxTokens: 80 }));
      const prompt =
        `In ONE sentence, say why this Indigenous supplier fits this corporate procurement commitment, and suggest the next step. ` +
        `Use only these facts.\nCommitment: ${commitmentText(c)}\nSupplier: ${supplierText(s)} (${s.identityTier}).`;
      const out = (await model.call(prompt)).trim();
      if (out) return out.slice(0, 240);
    } catch {
      /* fall through to the deterministic template */
    }
  }
  return templateRationale(c, s, reasons);
}

// Deterministic, honest one-liner from real facts — the always-available baseline.
function templateRationale(c: Commitment, s: Supplier, reasons: OpportunityReasons): string {
  const tier = TIER_LABELS[s.identityTier]; // "Nation-verified" / "CCIB-certified"
  const sectorLabel = SECTOR_LABELS[c.sector] ?? c.sector;
  const own = typeof s.ownershipPct === "number" ? ` ${s.ownershipPct}% Indigenous-owned.` : "";
  if (reasons.sectorMatch) {
    return `${tier} supplier in ${sectorLabel} — matches this commitment's ${sectorLabel.toLowerCase()} procurement target.${own} Next: broker an introduction.`;
  }
  if (reasons.relevance >= 0.5) {
    return `${tier} supplier whose capabilities overlap this commitment's target, across sectors.${own} Next: assess fit with the procurement lead.`;
  }
  return `${tier} verified Indigenous supplier available for this procurement commitment.${own} Next: assess fit with the procurement lead.`;
}
