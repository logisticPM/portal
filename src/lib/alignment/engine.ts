// ===========================================================================
// Alignment engine — given a procurement commitment + the supplier pool, score
// each verified supplier (structured + embedding-cosine), keep Top-N above the
// threshold, attach a best-effort AI rationale, and upsert Opportunity rows.
// Reuses the cases embedder (stub offline / Bedrock in prod) and Converse LLM.
// ===========================================================================
import type { Commitment } from "../commitments/types";
import type { Supplier, Party } from "../repo/types";
import { getEmbedder } from "../cases/search/embedder";
import { cachedModel, modelFromId } from "../cases/ingest/llm";
import { cosine, structuredScore, combine, THRESHOLD, TOP_N } from "./score";
import type { Opportunity, OpportunityRepo } from "./types";
import { opportunityId } from "./types";

const NOW = () => new Date().toISOString();

function commitmentText(c: Commitment): string {
  return [c.title, c.detail, c.targetText].filter(Boolean).join(" · ");
}
function supplierText(s: Supplier): string {
  return [s.name, s.sector, s.blurb].filter(Boolean).join(" · ");
}
const isVerifiedSupplier = (s: Supplier) => s.identityTier === "nation" || s.identityTier === "ccab";

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

  // Semantic: embed the commitment + every supplier in one batch (stub offline).
  const embedder = getEmbedder();
  const [commitVec, ...supVecs] = await embedder.embed([commitmentText(commitment), ...suppliers.map(supplierText)]);

  const scored: Opportunity[] = suppliers.map((s, i) => {
    const sectorMatch = !!s.sectorNorm && s.sectorNorm === commitment.sector;
    const regionMatch = false; // commitments carry no region field in the MVP data
    const semantic = Math.max(0, cosine(commitVec, supVecs[i]));
    const structured = structuredScore({ sectorMatch, regionMatch, identityTier: s.identityTier, ownershipPct: s.ownershipPct });
    const score = combine(structured, semantic);
    return {
      id: opportunityId(commitment.id, s.id),
      commitmentId: commitment.id,
      orgId: commitment.orgId as string,
      supplierId: s.id,
      supplierName: s.name,
      commitmentTitle: commitment.title,
      score,
      reasons: { sectorMatch, regionMatch, identityTier: s.identityTier, semantic },
      status: "new",
      createdAt: NOW(),
    };
  });

  const kept = scored.filter((o) => o.score >= THRESHOLD).sort((a, b) => b.score - a.score).slice(0, TOP_N);
  const keptIds = new Set(kept.map((o) => o.id));

  // Best-effort AI rationale (never blocks; stub model offline).
  for (const o of kept) {
    try {
      o.rationale = await rationale(commitment, suppliers.find((s) => s.id === o.supplierId)!);
    } catch {
      /* leave rationale undefined */
    }
    await repo.upsert(o);
  }
  // prune sub-threshold pairs that may have existed before for this commitment
  for (const o of scored) if (!keptIds.has(o.id)) await repo.remove(o.id);
  return kept;
}

async function rationale(c: Commitment, s: Supplier): Promise<string> {
  const modelId = process.env.LABEL_MODELS?.split(",")[0]?.trim() || "stub:rationale";
  const model = cachedModel(modelFromId(modelId, { maxTokens: 80 }));
  const prompt =
    `In ONE sentence, say why this Indigenous supplier fits this corporate procurement commitment, and suggest the next step. ` +
    `Use only these facts.\nCommitment: ${commitmentText(c)}\nSupplier: ${supplierText(s)} (${s.identityTier}).`;
  const out = (await model.call(prompt)).trim();
  return out.slice(0, 240);
}
