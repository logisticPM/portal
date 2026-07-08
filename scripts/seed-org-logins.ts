// ===========================================================================
// One-off (synthetic data only): give every RAP-Index organization a COMPANY
// login, and link its commitments to that login (orgId = slug), so a teammate
// can sign in as any company and see that company's RAP commitments.
//
//   npx sst shell --stage <stage> -- tsx scripts/seed-org-logins.ts
//
// Idempotent: re-running overwrites the same User items (same email key) and
// re-links commitments. NOTE: a full commitments re-seed would drop the orgId
// backfill — re-run this script after any such reseed.
// ===========================================================================
import { Resource } from "sst";
import { hashPassword } from "../src/lib/auth/password";
import { toUserItem } from "../src/lib/dynamo/single-table";

const PASSWORD = "demo-portal-2026";
const CREATED_AT = "2025-01-15T00:00:00.000Z";

async function main() {
  // Resolve per-stage table names into env BEFORE importing the clients/repos
  // (client.ts + commitments repo read these once at module load).
  process.env.REPO_IMPL = "dynamo"; // sst shell doesn't set this → repos would default to the in-memory mock
  // `as any`: sst-env.d.ts (generated per-deploy) may not list every table in the
  // Resource type; the names resolve at runtime under `sst shell`.
  process.env.DYNAMO_TABLE = (Resource as any).DataPortal.name;
  process.env.COMMITMENTS_TABLE = (Resource as any).Commitments.name;
  process.env.AWS_REGION = process.env.AWS_REGION ?? "us-east-1";

  const { ddbDoc, TABLE } = await import("../src/lib/dynamo/client");
  const { PutCommand } = await import("@aws-sdk/lib-dynamodb");
  const { commitmentsRepo, slugifyOrg } = await import("../src/lib/commitments");

  const all = await commitmentsRepo.listCommitments();

  // distinct orgs by name -> slug
  const slugByName = new Map<string, string>();
  for (const c of all) if (c.orgName) slugByName.set(c.orgName, slugifyOrg(c.orgName));

  // 1) a company login per org (email = <slug>@demo, shared demo password)
  const hash = await hashPassword(PASSWORD);
  let users = 0;
  for (const [, slug] of slugByName) {
    const item = toUserItem({
      email: `${slug}@demo`,
      passwordHash: hash,
      kind: "company",
      partyId: slug,
      createdAt: CREATED_AT,
    });
    await ddbDoc.send(new PutCommand({ TableName: TABLE, Item: item }));
    users++;
  }

  // 2) link each commitment to its org's login (orgId = slug), so
  //    /my-commitments (listCommitments({orgId: session.partyId})) finds them.
  let linked = 0;
  for (const c of all) {
    if (!c.orgName) continue;
    const slug = slugifyOrg(c.orgName);
    if (c.orgId !== slug) await commitmentsRepo.createCommitment({ ...c, orgId: slug });
    linked++;
  }

  console.log(`✅ org logins created: ${users} companies (email=<slug>@demo, password=${PASSWORD})`);
  console.log(`✅ commitments linked to a login: ${linked} (orgId=<slug>)`);
  console.log(
    "   sample:",
    [...slugByName].slice(0, 6).map(([n, s]) => `${s}@demo ← ${n}`).join("  |  "),
  );
}

main().catch((e) => {
  console.error("❌ seed-org-logins failed:", e);
  process.exit(1);
});
