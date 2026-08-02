// Dynamo access for single-case Q&A. Mirrors briefs/repo; items are invisible to the corpus
// (et:"CaseQa", no GSI1PK). No global listing → no GSI2. Question hash is scoped per case.
import { createHash } from "node:crypto";
import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { casesDdbDoc as ddbDoc } from "../../dynamo/client";
import { normalizeQuestion } from "../briefs/repo";
import type { CaseQa, CaseQaAnswer, QaFailKind } from "./types";

const TABLE = process.env.CASES_TABLE ?? "LegalCases";
export const CASEQA_DAILY_LIMIT = Number(process.env.CASEQA_DAILY_LIMIT ?? 10);

export const caseQaKeys = {
  qa: (id: string) => ({ PK: `CASEQA#${id}`, SK: "CASEQA" }),
  qhash: (h: string) => ({ PK: `CQHASH#${h}`, SK: "CQHASH" }),
  quota: (date: string, requester: string) => ({ PK: `CQUOTA#${date}#${requester}`, SK: "CQUOTA" }),
};

// Per-case question hash: same question on two cases ⇒ different hash.
export const caseQuestionHash = (caseId: string, question: string): string =>
  createHash("sha256").update(`${caseId}\n${normalizeQuestion(question)}`).digest("hex").slice(0, 32);

export async function createCaseQa(qa: CaseQa): Promise<void> {
  await ddbDoc.send(new PutCommand({ TableName: TABLE, Item: { ...caseQaKeys.qa(qa.id), et: "CaseQa", data: qa } }));
}

export async function getCaseQa(id: string): Promise<CaseQa | null> {
  const r = await ddbDoc.send(new GetCommand({ TableName: TABLE, Key: caseQaKeys.qa(id) }));
  return (r.Item?.data as CaseQa | undefined) ?? null;
}

export async function setCaseQaDone(id: string, questionHash: string, answer: CaseQaAnswer, droppedClaims: number): Promise<void> {
  await ddbDoc.send(new UpdateCommand({
    TableName: TABLE, Key: caseQaKeys.qa(id),
    UpdateExpression: "SET #d.#s = :s, #d.#a = :a, #d.#dc = :dc",
    ExpressionAttributeNames: { "#d": "data", "#s": "status", "#a": "answer", "#dc": "droppedClaims" },
    ExpressionAttributeValues: { ":s": "done", ":a": answer, ":dc": droppedClaims },
  }));
  await ddbDoc.send(new PutCommand({ TableName: TABLE, Item: { ...caseQaKeys.qhash(questionHash), et: "CaseQaHash", data: { caseQaId: id } } }));
}

export async function setCaseQaFailed(
  id: string, failReason: string, failKind?: QaFailKind, bestOverlap?: number,
): Promise<void> {
  // Built conditionally rather than always SETting all four: DynamoDB rejects an
  // ExpressionAttributeValues entry that is never referenced, and the client's
  // removeUndefinedValues would strip the value while leaving the path in the expression.
  const names: Record<string, string> = { "#d": "data", "#s": "status", "#f": "failReason" };
  const values: Record<string, unknown> = { ":s": "failed", ":f": failReason };
  const sets = ["#d.#s = :s", "#d.#f = :f"];
  if (failKind !== undefined) { names["#fk"] = "failKind"; values[":fk"] = failKind; sets.push("#d.#fk = :fk"); }
  if (bestOverlap !== undefined) { names["#bo"] = "bestOverlap"; values[":bo"] = bestOverlap; sets.push("#d.#bo = :bo"); }
  await ddbDoc.send(new UpdateCommand({
    TableName: TABLE, Key: caseQaKeys.qa(id),
    UpdateExpression: "SET " + sets.join(", "),
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }));
}

export async function findByCaseQuestionHash(hash: string): Promise<CaseQa | null> {
  const r = await ddbDoc.send(new GetCommand({ TableName: TABLE, Key: caseQaKeys.qhash(hash) }));
  const id = (r.Item?.data as { caseQaId?: string } | undefined)?.caseQaId;
  return id ? getCaseQa(id) : null;
}

export async function bumpCaseQaQuota(requester: string, date: string): Promise<number> {
  const r = await ddbDoc.send(new UpdateCommand({
    TableName: TABLE, Key: caseQaKeys.quota(date, requester),
    UpdateExpression: "ADD #c :one",
    ExpressionAttributeNames: { "#c": "count" },
    ExpressionAttributeValues: { ":one": 1 },
    ReturnValues: "UPDATED_NEW",
  }));
  if (r.Attributes?.count === undefined) throw new Error("bumpCaseQaQuota: no count returned");
  return Number(r.Attributes.count);
}
