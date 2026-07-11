// ===========================================================================
// Alignment domain — a scored match between a company procurement commitment
// and a verified Indigenous supplier. See docs/specs/2026-07-08-alignment-engine-design.md
// ===========================================================================
import type { IdentityTier } from "../repo/types";

export type OpportunityStatus = "new" | "seen" | "acted" | "dismissed";

export interface OpportunityReasons {
  sectorMatch: boolean;
  relevance: number; // 0..1 deterministic BM25 capability overlap (blended w/ real embedding cosine when configured)
  identityTier: IdentityTier;
  semantic?: number; // 0..1 real-embedder cosine — present ONLY when a real EMBED_PROVIDER is configured
}

export interface Opportunity {
  id: string; // `${commitmentId}::${supplierId}` — deterministic, idempotent
  commitmentId: string;
  orgId: string; // the committing company (drives the company-view read)
  supplierId: string;
  supplierName: string; // denormalized for list rendering
  commitmentTitle: string; // denormalized for the radar
  score: number; // 0..1 combined
  reasons: OpportunityReasons;
  rationale?: string; // AI one-liner (optional; best-effort)
  status: OpportunityStatus;
  createdAt: string; // ISO 8601
}

export interface OpportunityRepo {
  listForOrg(orgId: string): Promise<Opportunity[]>; // company view (approach A)
  listAll(): Promise<Opportunity[]>; // institute radar (approach C)
  upsert(o: Opportunity): Promise<Opportunity>;
  remove(id: string): Promise<void>;
  setStatus(id: string, status: OpportunityStatus): Promise<void>;
}

export const opportunityId = (commitmentId: string, supplierId: string) =>
  `${commitmentId}::${supplierId}`;
