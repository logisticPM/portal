// ===========================================================================
// RAP layer — single-table design (SEPARATE table `RapData`).
//
// One table holds the staging job + the canonical entities; access patterns:
//   • get/put an extraction job        → main:  PK=EXTRACT#<id>   SK=META
//   • review queue (jobs by status)     → GSI1:  GSI1PK=STATUS#<status>
//   • get/put an org profile            → main:  PK=ORG#<id>       SK=META
//   • get/put a RAP header              → main:  PK=ORG#<id>       SK=RAP#<rapId>
//   • get a RAP header by rapId alone   → GSI1:  GSI1PK=RAP#<rapId> (GSI1 is
//        overloaded: it holds extraction jobs keyed STATUS#… AND RAP headers
//        keyed RAP#… — heterogeneous partition keys, standard single-table.)
//   • commitments for a RAP             → main:  PK=RAP#<rapId>    SK begins COMMIT#
//   • commitments by sector             → GSI2:  GSI2PK=SECTOR#<sector>
//   • a commitment's progress over time → main:  PK=COMMIT#<id>    SK begins OBS#<ISO ts>
//   • a commitment rollup               → main:  PK=COMMIT#<id>    SK=META
//
// Same generic key attributes (PK/SK/GSI1PK/GSI1SK/GSI2PK/GSI2SK) as the portal
// and survey tables, so `scripts/create-table.ts` creates it too — just set
// DYNAMO_TABLE=RapData.
// ===========================================================================
import type {
  Commitment,
  CommitmentRollup,
  ExtractionJob,
  Observation,
  OrgClaim,
  RapDocument,
  RapOrganization,
} from "../rap/types";

export const RAP_TABLE = process.env.RAP_TABLE ?? "RapData";
export const RAP_GSI1 = "GSI1"; // extraction jobs by status (review queue)
export const RAP_GSI2 = "GSI2"; // commitments by sector

export const keys = {
  job: (id: string) => ({ PK: `EXTRACT#${id}`, SK: "META" }),
  org: (id: string) => ({ PK: `ORG#${id}`, SK: "META" }),
  rap: (orgId: string, rapId: string) => ({ PK: `ORG#${orgId}`, SK: `RAP#${rapId}` }),
  commitment: (rapId: string, commitId: string) => ({ PK: `RAP#${rapId}`, SK: `COMMIT#${commitId}` }),
  observation: (commitId: string, observedAt: string) => ({ PK: `COMMIT#${commitId}`, SK: `OBS#${observedAt}` }),
  rollup: (commitId: string) => ({ PK: `COMMIT#${commitId}`, SK: "META" }),
  claim: (bn: string, partyId: string) => ({ PK: `ORGCLAIM#${bn}`, SK: `PARTY#${partyId}` }),
};

export type RapEntityType = "Job" | "Org" | "Rap" | "Commitment" | "Observation" | "Rollup" | "Claim";

// --- marshalling: domain object → table item -------------------------------
export function toJobItem(j: ExtractionJob) {
  return {
    ...keys.job(j.id),
    et: "Job" as RapEntityType,
    GSI1PK: `STATUS#${j.status}`,
    GSI1SK: `EXTRACT#${j.id}`,
    ...j,
  };
}

export function toOrgItem(o: RapOrganization) {
  return { ...keys.org(o.id), et: "Org" as RapEntityType, ...o };
}

export function toRapItem(r: RapDocument) {
  return {
    ...keys.rap(r.orgId, r.id),
    et: "Rap" as RapEntityType,
    GSI1PK: `RAP#${r.id}`, // fetch a RAP header by rapId without knowing orgId
    GSI1SK: "META",
    ...r,
  };
}

export function toCommitmentItem(c: Commitment) {
  return {
    ...keys.commitment(c.rapId, c.id),
    et: "Commitment" as RapEntityType,
    GSI2PK: `SECTOR#${c.sector}`,
    GSI2SK: `COMMIT#${c.commitmentType}#${c.id}`,
    ...c,
  };
}

export function toObservationItem(o: Observation) {
  return { ...keys.observation(o.commitId, o.observedAt), et: "Observation" as RapEntityType, ...o };
}

export function toRollupItem(r: CommitmentRollup) {
  return { ...keys.rollup(r.commitId), et: "Rollup" as RapEntityType, ...r };
}

export function toClaimItem(c: OrgClaim) {
  return {
    ...keys.claim(c.businessNumber, c.partyId),
    et: "Claim" as RapEntityType,
    GSI1PK: `PARTY#${c.partyId}`,
    GSI1SK: `ORGCLAIM#${c.businessNumber}`,
    ...c,
  };
}

// --- unmarshalling: table item → domain object (strip the key attributes) ---
/* eslint-disable @typescript-eslint/no-unused-vars */
function strip<T>(it: Record<string, any>): T {
  const { PK, SK, et, GSI1PK, GSI1SK, GSI2PK, GSI2SK, ...rest } = it;
  return rest as T;
}

export const itemToJob = (it: Record<string, any>) => strip<ExtractionJob>(it);
export const itemToOrg = (it: Record<string, any>) => strip<RapOrganization>(it);
export const itemToRap = (it: Record<string, any>) => strip<RapDocument>(it);
export const itemToCommitment = (it: Record<string, any>) => strip<Commitment>(it);
export const itemToObservation = (it: Record<string, any>) => strip<Observation>(it);
export const itemToRollup = (it: Record<string, any>) => strip<CommitmentRollup>(it);
export const itemToClaim = (it: Record<string, any>) => strip<OrgClaim>(it);
