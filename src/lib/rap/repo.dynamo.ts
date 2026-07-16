// ===========================================================================
// rapRepo + extractionRepo — DynamoDB implementation (RapData table).
// Table-agnostic ddbDoc client + explicit RAP_TABLE, so it coexists with the
// portal (DataPortal) and survey (RapSurvey) tables in the same process.
// Selected via REPO_IMPL=dynamo.
// ===========================================================================
import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../dynamo/client";
import {
  RAP_GSI1,
  RAP_GSI2,
  RAP_TABLE,
  itemToClaim,
  itemToCommitment,
  itemToJob,
  itemToObservation,
  itemToOrg,
  itemToRap,
  itemToRollup,
  keys,
  toClaimItem,
  toCommitmentItem,
  toJobItem,
  toObservationItem,
  toOrgItem,
  toRapItem,
  toRollupItem,
} from "../dynamo/rap-table";
import type {
  ExtractedRap,
  ExtractionJob,
  ExtractionRepo,
  ExtractionResult,
  ExtractionStatus,
  NewExtractionJob,
  RapRepo,
  Sector,
} from "./types";
import { RAP_SCHEMA_VERSION } from "./types";

const now = () => new Date().toISOString();

async function getJobOrThrow(id: string): Promise<ExtractionJob> {
  const res = await ddbDoc.send(new GetCommand({ TableName: RAP_TABLE, Key: keys.job(id) }));
  if (!res.Item) throw new Error(`ExtractionJob ${id} not found`);
  return itemToJob(res.Item);
}

// Re-put the whole job item. Simpler than partial UpdateExpressions and keeps
// GSI1PK (STATUS#…) in sync on every status change; job items are small.
async function putJob(job: ExtractionJob): Promise<ExtractionJob> {
  await ddbDoc.send(new PutCommand({ TableName: RAP_TABLE, Item: toJobItem(job) }));
  return job;
}

// --- extractionRepo --------------------------------------------------------
export const dynamoExtractionRepo: ExtractionRepo = {
  async createJob(input: NewExtractionJob) {
    const job: ExtractionJob = {
      id: input.id,
      fileName: input.fileName,
      sourceS3Key: input.sourceS3Key,
      status: "PENDING",
      schemaVersion: RAP_SCHEMA_VERSION,
      engine: null,
      classification: null,
      extracted: null,
      validationIssues: [],
      verdicts: [],
      reviewedBy: null,
      reviewNote: null,
      rapId: null,
      createdAt: now(),
      updatedAt: now(),
      businessNumber: null,
      businessNumberSource: null,
      registryLegalName: null,
      registryStatus: null,
      dataClass: input.dataClass,
    };
    return putJob(job);
  },

  async getJob(id) {
    const res = await ddbDoc.send(new GetCommand({ TableName: RAP_TABLE, Key: keys.job(id) }));
    return res.Item ? itemToJob(res.Item) : null;
  },

  async markExtracting(id) {
    const job = await getJobOrThrow(id);
    return putJob({ ...job, status: "EXTRACTING", updatedAt: now() });
  },

  async saveResult(id, result: ExtractionResult) {
    const job = await getJobOrThrow(id);
    return putJob({
      ...job,
      status: "PENDING_REVIEW",
      engine: result.engine,
      schemaVersion: result.schemaVersion,
      classification: result.classification,
      extracted: result.extracted,
      validationIssues: result.validationIssues,
      verdicts: result.verdicts,
      updatedAt: now(),
    });
  },

  async markFailed(id, error) {
    const job = await getJobOrThrow(id);
    return putJob({ ...job, status: "FAILED", reviewNote: error, updatedAt: now() });
  },

  async listByStatus(status: ExtractionStatus) {
    const res = await ddbDoc.send(
      new QueryCommand({
        TableName: RAP_TABLE,
        IndexName: RAP_GSI1,
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: { ":pk": `STATUS#${status}` },
      }),
    );
    return ((res.Items ?? []) as Record<string, any>[]).map(itemToJob);
  },

  async confirmJob(id, reviewedBy, edited: ExtractedRap, rapId) {
    const job = await getJobOrThrow(id);
    return putJob({
      ...job,
      status: "CONFIRMED",
      extracted: edited,
      reviewedBy,
      rapId,
      updatedAt: now(),
    });
  },

  async rejectJob(id, reviewedBy, reason) {
    const job = await getJobOrThrow(id);
    return putJob({ ...job, status: "REJECTED", reviewedBy, reviewNote: reason, updatedAt: now() });
  },

  async setJobOrg(id, org) {
    const job = await getJobOrThrow(id);
    return putJob({
      ...job,
      businessNumber: org?.businessNumber ?? null,
      businessNumberSource: org?.businessNumberSource ?? null,
      registryLegalName: org?.registryLegalName ?? null,
      registryStatus: org?.registryStatus ?? null,
      updatedAt: now(),
    });
  },
};

// --- rapRepo (canonical entities) ------------------------------------------
export const dynamoRapRepo: RapRepo = {
  async putOrganization(org) {
    await ddbDoc.send(new PutCommand({ TableName: RAP_TABLE, Item: toOrgItem(org) }));
    return org;
  },

  async getOrganization(id) {
    const res = await ddbDoc.send(new GetCommand({ TableName: RAP_TABLE, Key: keys.org(id) }));
    return res.Item ? itemToOrg(res.Item) : null;
  },

  async putRap(rap) {
    await ddbDoc.send(new PutCommand({ TableName: RAP_TABLE, Item: toRapItem(rap) }));
    return rap;
  },

  async getRap(id) {
    // RAP header lives at PK=ORG#<orgId>, SK=RAP#<id>; GSI1 is overloaded to
    // index it by rapId alone (GSI1PK=RAP#<id>) so callers needn't know orgId.
    const res = await ddbDoc.send(
      new QueryCommand({
        TableName: RAP_TABLE,
        IndexName: RAP_GSI1,
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: { ":pk": `RAP#${id}` },
        Limit: 1,
      }),
    );
    const item = (res.Items ?? [])[0];
    return item ? itemToRap(item) : null;
  },

  async listRapsByOrg(orgId) {
    const res = await ddbDoc.send(
      new QueryCommand({
        TableName: RAP_TABLE,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: { ":pk": `ORG#${orgId}`, ":sk": "RAP#" },
      }),
    );
    return ((res.Items ?? []) as Record<string, any>[]).map(itemToRap);
  },

  async putCommitment(c) {
    await ddbDoc.send(new PutCommand({ TableName: RAP_TABLE, Item: toCommitmentItem(c) }));
    return c;
  },

  async getCommitment(rapId, commitId) {
    const res = await ddbDoc.send(
      new GetCommand({ TableName: RAP_TABLE, Key: keys.commitment(rapId, commitId) }),
    );
    return res.Item ? itemToCommitment(res.Item) : null;
  },

  async listCommitmentsByRap(rapId) {
    const res = await ddbDoc.send(
      new QueryCommand({
        TableName: RAP_TABLE,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: { ":pk": `RAP#${rapId}`, ":sk": "COMMIT#" },
      }),
    );
    return ((res.Items ?? []) as Record<string, any>[]).map(itemToCommitment);
  },

  async listCommitmentsBySector(sector: Sector) {
    const res = await ddbDoc.send(
      new QueryCommand({
        TableName: RAP_TABLE,
        IndexName: RAP_GSI2,
        KeyConditionExpression: "GSI2PK = :pk",
        ExpressionAttributeValues: { ":pk": `SECTOR#${sector}` },
      }),
    );
    return ((res.Items ?? []) as Record<string, any>[]).map(itemToCommitment);
  },

  // cascade-delete a RAP's canonical graph (commitments + their rollups +
  // observations, then the RAP header). Idempotent — no-op if nothing exists.
  async deleteRapGraph(orgId, rapId) {
    const cres = await ddbDoc.send(
      new QueryCommand({
        TableName: RAP_TABLE,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: { ":pk": `RAP#${rapId}`, ":sk": "COMMIT#" },
      }),
    );
    const commits = ((cres.Items ?? []) as Record<string, any>[]).map(itemToCommitment);
    for (const c of commits) {
      const ores = await ddbDoc.send(
        new QueryCommand({
          TableName: RAP_TABLE,
          KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
          ExpressionAttributeValues: { ":pk": `COMMIT#${c.id}`, ":sk": "OBS#" },
        }),
      );
      for (const o of (ores.Items ?? []) as Record<string, any>[]) {
        await ddbDoc.send(new DeleteCommand({ TableName: RAP_TABLE, Key: { PK: o.PK, SK: o.SK } }));
      }
      await ddbDoc.send(new DeleteCommand({ TableName: RAP_TABLE, Key: keys.rollup(c.id) }));
      await ddbDoc.send(new DeleteCommand({ TableName: RAP_TABLE, Key: keys.commitment(rapId, c.id) }));
    }
    await ddbDoc.send(new DeleteCommand({ TableName: RAP_TABLE, Key: keys.rap(orgId, rapId) }));
  },

  async putObservation(o) {
    await ddbDoc.send(new PutCommand({ TableName: RAP_TABLE, Item: toObservationItem(o) }));
    return o;
  },

  // time-series read: PK=COMMIT#<id>, SK between OBS#<from> and OBS#<to>
  async listObservations(commitId, from, to) {
    const res = await ddbDoc.send(
      new QueryCommand({
        TableName: RAP_TABLE,
        KeyConditionExpression: "PK = :pk AND SK BETWEEN :lo AND :hi",
        ExpressionAttributeValues: {
          ":pk": `COMMIT#${commitId}`,
          ":lo": `OBS#${from ?? ""}`,
          ":hi": `OBS#${to ?? "￿"}`,
        },
      }),
    );
    return ((res.Items ?? []) as Record<string, any>[]).map(itemToObservation);
  },

  async putRollup(r) {
    await ddbDoc.send(new PutCommand({ TableName: RAP_TABLE, Item: toRollupItem(r) }));
    return r;
  },

  async getRollup(commitId) {
    const res = await ddbDoc.send(
      new GetCommand({ TableName: RAP_TABLE, Key: keys.rollup(commitId) }),
    );
    return res.Item ? itemToRollup(res.Item) : null;
  },

  // Option-A re-extraction lock: query commitments by rapId, then each
  // commitment's observations, short-circuiting true on the first
  // recordedBy !== "system" (same key patterns as deleteRapGraph above).
  async hasCompanyProgress(rapId) {
    const cres = await ddbDoc.send(
      new QueryCommand({
        TableName: RAP_TABLE,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: { ":pk": `RAP#${rapId}`, ":sk": "COMMIT#" },
      }),
    );
    const commits = ((cres.Items ?? []) as Record<string, any>[]).map(itemToCommitment);
    for (const c of commits) {
      const ores = await ddbDoc.send(
        new QueryCommand({
          TableName: RAP_TABLE,
          KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
          ExpressionAttributeValues: { ":pk": `COMMIT#${c.id}`, ":sk": "OBS#" },
        }),
      );
      const observations = ((ores.Items ?? []) as Record<string, any>[]).map(itemToObservation);
      if (observations.some((o) => o.recordedBy !== "system")) return true;
    }
    return false;
  },

  async putClaim(c) {
    await ddbDoc.send(new PutCommand({ TableName: RAP_TABLE, Item: toClaimItem(c) }));
    return c;
  },

  async getClaim(bn, partyId) {
    const res = await ddbDoc.send(
      new GetCommand({ TableName: RAP_TABLE, Key: keys.claim(bn, partyId) }),
    );
    return res.Item ? itemToClaim(res.Item) : null;
  },

  // claims for a party: GSI1PK = PARTY#<partyId> (GSI1 is overloaded with
  // STATUS#/RAP#/PARTY# partition keys — standard single-table heterogeneity).
  async listClaimsByParty(partyId) {
    const res = await ddbDoc.send(
      new QueryCommand({
        TableName: RAP_TABLE,
        IndexName: RAP_GSI1,
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: { ":pk": `PARTY#${partyId}` },
      }),
    );
    return ((res.Items ?? []) as Record<string, any>[]).map(itemToClaim);
  },

  async listClaimsByBN(bn: string) {
    const res = await ddbDoc.send(new QueryCommand({
      TableName: RAP_TABLE,
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: { ":pk": `ORGCLAIM#${bn}` },
    }));
    return ((res.Items ?? []) as Record<string, any>[]).map(itemToClaim).filter((c) => c.status === "granted");
  },
};
