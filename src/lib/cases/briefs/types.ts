// THE BRIEFS SEAM. Briefings are user-generated artifacts, deliberately OUTSIDE
// the CaseRepo seam (keeps the dynamo≡mock gold standard untouched).
export type BriefStatus = "pending" | "done" | "failed";
export interface BriefPrecedent { caseId: string; establishes: string; relevance: string }
export interface BriefPrinciple { text: string; caseIds: string[] }
export interface BriefingBody {
  background: string;            // 1-2 sentences framing the question
  precedents: BriefPrecedent[];  // ≥2 after verification, each caseId ∈ retrieved set
  principles: BriefPrinciple[];  // cross-case principles, each caseId valid
  considerations: string;        // what the precedents mean — non-advisory framing
}
export interface Briefing {
  id: string;                    // crypto.randomUUID()
  question: string;              // as asked (trimmed)
  questionHash: string;          // sha256 of the normalized question
  status: BriefStatus;
  body?: BriefingBody;           // when done
  retrievedCaseIds: string[];    // provenance: the top-k retrieval set
  failReason?: string;           // when failed (honest, user-visible)
  droppedPoints?: number;        // verification-dropped precedents/principles
  model: string;
  requester: string;             // "kind" or "kind:partyId"
  createdAt: string;             // ISO timestamp
}
