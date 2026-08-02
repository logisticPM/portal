// The CASE-QA seam. Single-case grounded Q&A artifacts, mirroring briefs/ — deliberately
// OUTSIDE CaseRepo (keeps dynamo≡mock untouched). Answer = anchored claims (like a summary).
import type { CitationAnchor } from "../types";

export type CaseQaStatus = "pending" | "done" | "failed";
export interface CaseQaAnswer { claims: CitationAnchor[] }

// Why an answer could not be produced. `not_addressed` and `unverifiable` are the two the
// old code collapsed into one message: the first is the judgment being silent, the second
// is our verifier rejecting the model's quotes. Saying the first when it was the second
// tells the reader something false about a court decision.
export type QaFailKind = "no_full_text" | "unparseable" | "not_addressed" | "unverifiable";

export interface CaseQa {
  id: string;
  caseId: string;
  question: string;
  questionHash: string;   // sha256(caseId + "\n" + normalizeQuestion), first 32 hex
  status: CaseQaStatus;
  answer?: CaseQaAnswer;   // when done
  failReason?: string;     // when failed (honest, user-visible)
  droppedClaims?: number;
  failKind?: QaFailKind;   // when failed
  bestOverlap?: number;    // when failed as `unverifiable`: how close the best quote came
  model: string;
  requester: string;       // "kind" or "kind:partyId"
  createdAt: string;       // ISO
}
