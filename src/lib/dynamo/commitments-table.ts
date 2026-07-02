// SINGLE-TABLE DESIGN for Commitments (mirrors cases-table.ts). The corpus is
// small, so list/summary Scan + reduce in query.ts; GSI1/GSI2 exist for
// sector / type browse paths. getCommitment uses the main key.
import type { Commitment, CommitmentType, Sector } from "../commitments/types";

export const COMMITMENTS_TABLE = process.env.COMMITMENTS_TABLE ?? "Commitments";
export const GSI1 = "GSI1"; // sector browse
export const GSI2 = "GSI2"; // type browse
export type CommitmentEntityType = "Commitment";

export const commitmentKeys = {
  profile: (id: string) => ({ PK: `COMMITMENT#${id}`, SK: "PROFILE" }),
};
export const gsi1Sector = (s: Sector) => `SECTOR#${s}`;
export const gsi2Type = (t: CommitmentType) => `TYPE#${t}`;
export const gsiSk = (targetYear: number, id: string) => `YEAR#${targetYear}#COMMITMENT#${id}`;

export function toCommitmentItem(c: Commitment) {
  return {
    ...commitmentKeys.profile(c.id),
    et: "Commitment" as CommitmentEntityType,
    GSI1PK: gsi1Sector(c.sector),
    GSI1SK: gsiSk(c.targetYear, c.id),
    GSI2PK: gsi2Type(c.type),
    GSI2SK: gsiSk(c.targetYear, c.id),
    data: c, // store the full domain object; small + read-whole access pattern
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// Reconstruct with explicit field order so JSON.stringify equality holds vs the
// in-memory mock (DynamoDB does not preserve map-key order). Order MUST match
// the object built in fixtures.ts (`mk`).
export function itemToCommitment(it: any): Commitment {
  const d = it.data as Commitment;
  return {
    id: d.id,
    orgName: d.orgName,
    ...(d.orgId !== undefined ? { orgId: d.orgId } : {}),
    sector: d.sector,
    orgSize: d.orgSize,
    type: d.type,
    title: d.title,
    targetYear: d.targetYear,
    ...(d.rapType !== undefined ? { rapType: d.rapType } : {}),
    status: d.status,
    progressPct: d.progressPct,
    history: d.history.map((h: any) => ({
      period: h.period,
      status: h.status,
      progressPct: h.progressPct,
    })),
    createdAt: d.createdAt,
    ...(d.source !== undefined ? { source: { label: d.source.label, url: d.source.url } } : {}),
    ...(d.detail !== undefined ? { detail: d.detail } : {}),
    ...(d.targetText !== undefined ? { targetText: d.targetText } : {}),
  };
}
