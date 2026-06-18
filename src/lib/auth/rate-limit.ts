// ===========================================================================
// Login rate limiting. A small counter per email: { count, firstFailAt }. The
// window is logical (no DynamoDB TTL needed) — once WINDOW_MS since firstFailAt
// elapses, the counter resets. Backed by DynamoDB when REPO_IMPL=dynamo, else
// an in-memory map (local dev / verify). The lockout CHECK runs before the
// password hash, so locked-out/attacker requests never trigger scrypt.
// ===========================================================================
import { DeleteCommand, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc, TABLE } from "../dynamo/client";

export const MAX_FAILS = 5;
export const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

type Record_ = { count: number; firstFailAt: number };

const useDynamo = () => process.env.REPO_IMPL === "dynamo";
const mem = new Map<string, Record_>();
const key = (email: string) => ({ PK: `LOGINFAIL#${email.toLowerCase()}`, SK: "LOGINFAIL" });

async function read(email: string): Promise<Record_ | null> {
  if (!useDynamo()) return mem.get(email.toLowerCase()) ?? null;
  const res = await ddbDoc.send(new GetCommand({ TableName: TABLE, Key: key(email) }));
  return res.Item ? { count: res.Item.count, firstFailAt: res.Item.firstFailAt } : null;
}

async function write(email: string, rec: Record_): Promise<void> {
  if (!useDynamo()) { mem.set(email.toLowerCase(), rec); return; }
  await ddbDoc.send(new PutCommand({ TableName: TABLE, Item: { ...key(email), ...rec } }));
}

export async function clearFailures(email: string): Promise<void> {
  if (!useDynamo()) { mem.delete(email.toLowerCase()); return; }
  await ddbDoc.send(new DeleteCommand({ TableName: TABLE, Key: key(email) }));
}

// true = allowed to attempt; false = currently locked out.
export async function assertNotLocked(email: string): Promise<boolean> {
  const rec = await read(email);
  if (!rec) return true;
  if (Date.now() - rec.firstFailAt > WINDOW_MS) { await clearFailures(email); return true; }
  return rec.count < MAX_FAILS;
}

export async function recordFailure(email: string): Promise<void> {
  const rec = await read(email);
  const now = Date.now();
  if (!rec || now - rec.firstFailAt > WINDOW_MS) {
    await write(email, { count: 1, firstFailAt: now });
  } else {
    await write(email, { count: rec.count + 1, firstFailAt: rec.firstFailAt });
  }
}
