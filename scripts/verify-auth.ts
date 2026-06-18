// ===========================================================================
// Auth verification harness — `npm run verify:auth`.
// Pure checks (password, session) need no DB. The user-repo parity + rate-limit
// sections (added later) need DynamoDB Local (`npm run ddb:up`).
// ===========================================================================
import { hashPassword, verifyPassword } from "../src/lib/auth/password";
import { signSession, verifySession, type Session } from "../src/lib/auth";
import { itemToUser, toUserItem } from "../src/lib/dynamo/single-table";
import type { User } from "../src/lib/repo/types";
import { createSingleTable } from "../src/lib/dynamo/create";
import { mockRepo } from "../src/lib/repo/repo.mock";
import { dynamoRepo } from "../src/lib/repo/repo.dynamo";
import { DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../src/lib/dynamo/client";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`);
  ok ? pass++ : fail++;
}

async function main() {
  // --- password ---
  const stored = await hashPassword("correct horse");
  check("password: format is salt:hash", /^[0-9a-f]{32}:[0-9a-f]{128}$/.test(stored), stored.slice(0, 16) + "…");
  check("password: correct verifies", await verifyPassword("correct horse", stored));
  check("password: wrong rejected", !(await verifyPassword("wrong", stored)));
  check("password: malformed rejected", !(await verifyPassword("x", "not-a-hash")));

  // --- session sign/verify ---
  const NOW = 1_700_000_000;
  const sess: Session = { kind: "company", partyId: "c-northway", email: "northway@demo" };
  const token = signSession(sess, NOW);
  const ok = verifySession(token, NOW + 10);
  check("session: round-trips", !!ok && ok.kind === "company" && ok.partyId === "c-northway" && ok.email === "northway@demo");
  check("session: expired rejected", verifySession(token, NOW + 60 * 60 * 24 * 8) === null);
  check("session: tampered payload rejected", verifySession("x" + token, NOW + 10) === null);
  check("session: bad signature rejected", verifySession(token.split(".")[0] + ".deadbeef", NOW + 10) === null);
  const [bodyPart, sigPart] = token.split(".");
  const flipped = bodyPart + "." + (sigPart[0] === "A" ? "B" : "A") + sigPart.slice(1);
  check("session: same-length wrong signature rejected", verifySession(flipped, NOW + 10) === null);
  const inst = signSession({ kind: "indigenomics", email: "institute@demo" }, NOW);
  check("session: indigenomics has no partyId", verifySession(inst, NOW + 10)?.partyId === undefined);

  // --- user marshalling ---
  const u: User = { email: "northway@demo", passwordHash: "a:b", kind: "company", partyId: "c-northway", createdAt: "2025-01-15T00:00:00.000Z" };
  const item = toUserItem(u);
  check("user: PK is USER#<email>", item.PK === "USER#northway@demo" && item.SK === "USER");
  check("user: round-trips via itemToUser", JSON.stringify(itemToUser(item)) === JSON.stringify(u));
  const uIndig: User = { email: "institute@demo", passwordHash: "x:y", kind: "indigenomics", createdAt: "2025-01-15T00:00:00.000Z" };
  check("user: indigenomics round-trips (no partyId)", JSON.stringify(itemToUser(toUserItem(uIndig))) === JSON.stringify(uIndig));

  // --- user repo parity (DynamoDB Local) ---
  if (process.env.DYNAMO_ENDPOINT) {
    await createSingleTable("DataPortal");
    const acct: User = { email: "Parity@Demo", passwordHash: "s:h", kind: "supplier", partyId: "s-eagle", createdAt: "2025-01-15T00:00:00.000Z" };
    await mockRepo.createUser(acct);
    await dynamoRepo.createUser(acct);
    const m = await mockRepo.getUserByEmail("parity@demo");
    const d = await dynamoRepo.getUserByEmail("parity@demo");
    check("user: email lowercased on create", m?.email === "parity@demo" && d?.email === "parity@demo");
    check("user: mock ≡ dynamo", JSON.stringify(m) === JSON.stringify(d));
    check("user: unknown email → null", (await dynamoRepo.getUserByEmail("nobody@demo")) === null);
    await ddbDoc.send(new DeleteCommand({ TableName: "DataPortal", Key: { PK: "USER#parity@demo", SK: "USER" } }));
  } else {
    console.warn("⚠️  user repo parity skipped — set DYNAMO_ENDPOINT (npm run ddb:up) for full coverage");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("❌ verify-auth crashed:", e);
  process.exit(1);
});
