// ===========================================================================
// Data classification (governance spec §6). The tag that decides which key
// encrypts an artifact, which IAM policy governs it, and whether it is in the
// CloudTrail audit scope.
//
//   public       — published disclosure; may be hosted anywhere (client rule).
//   org_submitted — a company's own submission; Canadian hosting + access
//                   controls (client rule). The CONSERVATIVE default.
// ===========================================================================
export type DataClass = "public" | "org_submitted";
