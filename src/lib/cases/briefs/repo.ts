// Dynamo access for briefings. Items live in the LegalCases table but are
// invisible to the corpus by construction: no GSI1PK (scanAll scans GSI1), and
// listing rides GSI2 under a dedicated "BRIEF#ALL" partition (no collision with
// WINTYPE#… browse keys). Payload sits under `data` like every other item.
import { createHash } from "node:crypto";
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../../dynamo/client";
import { GSI2 } from "../../dynamo/cases-table";
import { normWs } from "../ingest/summarizer";
import type { Briefing, BriefingBody } from "./types";

const TABLE = process.env.CASES_TABLE ?? "LegalCases";
export const BRIEF_DAILY_LIMIT = Number(process.env.BRIEF_DAILY_LIMIT ?? 10);

export const briefKeys = {
  brief: (id: string) => ({ PK: `BRIEF#${id}`, SK: "BRIEF" }),
  qhash: (h: string) => ({ PK: `QHASH#${h}`, SK: "QHASH" }),
  quota: (date: string, requester: string) => ({ PK: `BQUOTA#${date}#${requester}`, SK: "BQUOTA" }),
};

// Same-question detection: lowercase, fold whitespace/typographic punctuation
// (normWs), strip trailing punctuation. Hash = first 32 hex of sha256.
export function normalizeQuestion(q: string): string {
  return normWs(q).toLowerCase().replace(/[?!.,;:'"\s]+$/, "");
}
export const questionHash = (q: string): string =>
  createHash("sha256").update(normalizeQuestion(q)).digest("hex").slice(0, 32);

export async function createBrief(b: Briefing): Promise<void> {
  await ddbDoc.send(new PutCommand({
    TableName: TABLE,
    Item: { ...briefKeys.brief(b.id), et: "Brief", GSI2PK: "BRIEF#ALL", GSI2SK: b.createdAt, data: b },
  }));
}

export async function getBrief(id: string): Promise<Briefing | null> {
  const r = await ddbDoc.send(new GetCommand({ TableName: TABLE, Key: briefKeys.brief(id) }));
  return (r.Item?.data as Briefing | undefined) ?? null;
}

export async function setBriefRetrieved(id: string, caseIds: string[]): Promise<void> {
  await ddbDoc.send(new UpdateCommand({
    TableName: TABLE, Key: briefKeys.brief(id),
    UpdateExpression: "SET #d.#r = :r",
    ExpressionAttributeNames: { "#d": "data", "#r": "retrievedCaseIds" },
    ExpressionAttributeValues: { ":r": caseIds },
  }));
}

export async function setBriefDone(id: string, questionHash: string, body: BriefingBody, droppedPoints: number): Promise<void> {
  await ddbDoc.send(new UpdateCommand({
    TableName: TABLE, Key: briefKeys.brief(id),
    // STATUS is a DynamoDB reserved word — alias every path segment.
    UpdateExpression: "SET #d.#s = :s, #d.#b = :b, #d.#dp = :dp",
    ExpressionAttributeNames: { "#d": "data", "#s": "status", "#b": "body", "#dp": "droppedPoints" },
    ExpressionAttributeValues: { ":s": "done", ":b": body, ":dp": droppedPoints },
  }));
  // Cache pointer: written only when a briefing completes (done), never on create/failed.
  await ddbDoc.send(new PutCommand({
    TableName: TABLE,
    Item: { ...briefKeys.qhash(questionHash), et: "BriefQHash", data: { briefId: id } },
  }));
}

export async function setBriefFailed(id: string, failReason: string): Promise<void> {
  await ddbDoc.send(new UpdateCommand({
    TableName: TABLE, Key: briefKeys.brief(id),
    UpdateExpression: "SET #d.#s = :s, #d.#f = :f",
    ExpressionAttributeNames: { "#d": "data", "#s": "status", "#f": "failReason" },
    ExpressionAttributeValues: { ":s": "failed", ":f": failReason },
  }));
}

export async function findByQuestionHash(hash: string): Promise<Briefing | null> {
  const r = await ddbDoc.send(new GetCommand({ TableName: TABLE, Key: briefKeys.qhash(hash) }));
  const briefId = (r.Item?.data as { briefId?: string } | undefined)?.briefId;
  return briefId ? getBrief(briefId) : null;
}

// Returns the requester's usage count for the day AFTER incrementing.
export async function bumpQuota(requester: string, date: string): Promise<number> {
  const r = await ddbDoc.send(new UpdateCommand({
    TableName: TABLE, Key: briefKeys.quota(date, requester),
    // COUNT is a DynamoDB reserved word — alias it.
    UpdateExpression: "ADD #c :one",
    ExpressionAttributeNames: { "#c": "count" },
    ExpressionAttributeValues: { ":one": 1 },
    ReturnValues: "UPDATED_NEW",
  }));
  // Fail CLOSED: a missing count must not read as "under the limit".
  if (r.Attributes?.count === undefined) throw new Error("bumpQuota: no count returned");
  return Number(r.Attributes.count);
}

export async function listRecentBriefs(limit = 20): Promise<Briefing[]> {
  const r = await ddbDoc.send(new QueryCommand({
    TableName: TABLE, IndexName: GSI2,
    KeyConditionExpression: "GSI2PK = :p",
    ExpressionAttributeValues: { ":p": "BRIEF#ALL" },
    ScanIndexForward: false, Limit: limit,
  }));
  return (r.Items ?? []).map((i) => i.data as Briefing);
}
