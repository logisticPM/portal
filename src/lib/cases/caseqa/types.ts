// The CASE-QA seam. Single-case grounded Q&A artifacts, mirroring briefs/ — deliberately
// OUTSIDE CaseRepo (keeps dynamo≡mock untouched). Answer = anchored claims (like a summary).
import type { CitationAnchor } from "../types";

export type CaseQaStatus = "pending" | "done" | "failed";
export interface CaseQaAnswer { claims: CitationAnchor[] }
export interface CaseQa {
  id: string;
  caseId: string;
  question: string;
  questionHash: string;   // sha256(caseId + "\n" + normalizeQuestion), first 32 hex
  status: CaseQaStatus;
  answer?: CaseQaAnswer;   // when done
  failReason?: string;     // when failed (honest, user-visible)
  droppedClaims?: number;
  model: string;
  requester: string;       // "kind" or "kind:partyId"
  createdAt: string;       // ISO
}
