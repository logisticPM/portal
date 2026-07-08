// ===========================================================================
// Seed loader (spec §10.2 — Sunny owns this). Writes the fixtures into the table
// using the single-table marshallers, so the items land with the exact keys/GSIs
// the reads expect. Idempotent: PutItem overwrites items with the same key.
//
//   npm run ddb:seed       (Local)
// ===========================================================================
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc, TABLE } from "../dynamo/client";
import { toConfItem, toLineItem, toPartyItem, toUserItem } from "../dynamo/single-table";
import { confirmations, DEMO_PASSWORD, demoUsers, lines, parties, T } from "./fixtures";
import { hashPassword } from "../auth/password";
import type { User } from "../repo/types";

export async function seedAll(): Promise<{
  parties: number;
  lines: number;
  confirmations: number;
  users: number;
}> {
  // a confirmation needs its line's companyId to land in the right partition
  const lineCompany = new Map(lines.map((l) => [l.id, l.companyId]));

  const items: Record<string, unknown>[] = [
    ...parties.map(toPartyItem),
    ...lines.map(toLineItem),
    ...confirmations.map((c) => toConfItem(c, lineCompany.get(c.lineId)!)),
  ];

  const hash = await hashPassword(DEMO_PASSWORD);
  const userItems = demoUsers.map((u) =>
    toUserItem({ email: u.email, passwordHash: hash, kind: u.kind, partyId: u.partyId, createdAt: T } as User),
  );
  items.push(...userItems);

  for (const Item of items) {
    await ddbDoc.send(new PutCommand({ TableName: TABLE, Item }));
  }

  return {
    parties: parties.length,
    lines: lines.length,
    confirmations: confirmations.length,
    users: demoUsers.length,
  };
}
