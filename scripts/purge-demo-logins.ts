// ===========================================================================
// Data hygiene (before real client production): delete demo LOGIN accounts —
// the `@demo` User items sharing the `demo-portal-2026` password — while
// KEEPING a small keep-list (default: institute@demo) so the Indigenomics
// Institute retains staff access through the transition.
//
//   # dry run (default — shows what WOULD be deleted, changes nothing):
//   npx sst shell --stage <stage> -- tsx scripts/purge-demo-logins.ts
//
//   # actually delete (keeps institute@demo by default):
//   npx sst shell --stage <stage> -- tsx scripts/purge-demo-logins.ts --apply
//
//   # keep extra logins too (union with the default keep-list):
//   npx sst shell --stage <stage> -- tsx scripts/purge-demo-logins.ts --apply --keep atb-financial@demo,bc-hydro@demo
//
// SAFETY: dry-run is the default; nothing is deleted without --apply. The script
// prints the resolved table name so you can confirm the stage before applying.
// Idempotent: re-running deletes only what still matches.
//
// SCOPE: this removes login *accounts* (User items) only. It does NOT delete the
// seeded showcase organizations / commitments (that public demo data is handled
// separately — "replace fixture corpora" in the deploy runbook §5.3). See also
// PROJECT-AUDIT §4.4.
// ===========================================================================
import { Resource } from "sst";

// The default keep-list: the Institute staff singleton. Always protected unless
// you edit this. Note institute@demo itself ends in "@demo", so without this it
// WOULD be deleted.
const DEFAULT_KEEP = ["institute@demo"];

// Partition scanned User items into keep vs delete. Pure + exported so the logic
// is testable without DynamoDB. A user is a purge target iff its email ends in
// "@demo" and it is not in the keep-set (case-insensitive).
export function partitionDemoUsers(
  users: { email: string; PK: string; SK: string }[],
  keep: Iterable<string>,
): { toDelete: typeof users; toKeep: typeof users } {
  const keepSet = new Set([...keep].map((e) => e.trim().toLowerCase()).filter(Boolean));
  const toDelete: typeof users = [];
  const toKeep: typeof users = [];
  for (const u of users) {
    const email = (u.email ?? "").toLowerCase();
    if (email.endsWith("@demo") && !keepSet.has(email)) toDelete.push(u);
    else toKeep.push(u);
  }
  return { toDelete, toKeep };
}

function parseArgs(argv: string[]) {
  const apply = argv.includes("--apply");
  let extraKeep: string[] = [];
  const ki = argv.findIndex((a) => a === "--keep" || a.startsWith("--keep="));
  if (ki >= 0) {
    const inline = argv[ki].startsWith("--keep=") ? argv[ki].slice("--keep=".length) : argv[ki + 1];
    extraKeep = (inline ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  }
  return { apply, keep: [...DEFAULT_KEEP, ...extraKeep] };
}

async function main() {
  const { apply, keep } = parseArgs(process.argv.slice(2));

  // Resolve the per-stage table name into env BEFORE importing the client (it
  // reads DYNAMO_TABLE once at module load). `as any`: the generated Resource
  // type may not list every table; the name resolves at runtime under sst shell.
  process.env.REPO_IMPL = "dynamo";
  process.env.DYNAMO_TABLE = (Resource as any).DataPortal.name;
  process.env.AWS_REGION = process.env.AWS_REGION ?? "us-east-1";

  const { ddbDoc, TABLE } = await import("../src/lib/dynamo/client");
  const { ScanCommand, DeleteCommand } = await import("@aws-sdk/lib-dynamodb");

  console.log(`\nTable:  ${TABLE}`);
  console.log(`Mode:   ${apply ? "APPLY (will delete)" : "DRY RUN (no changes)"}`);
  console.log(`Keep:   ${keep.join(", ")}\n`);

  // Scan all User items (et = "User"), paginating defensively.
  const users: { email: string; PK: string; SK: string }[] = [];
  let ExclusiveStartKey: Record<string, any> | undefined;
  do {
    const res: any = await ddbDoc.send(
      new ScanCommand({
        TableName: TABLE,
        FilterExpression: "et = :u",
        ExpressionAttributeValues: { ":u": "User" },
        ExclusiveStartKey,
      }),
    );
    for (const it of res.Items ?? []) {
      users.push({ email: it.email, PK: it.PK, SK: it.SK });
    }
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  const { toDelete, toKeep } = partitionDemoUsers(users, keep);

  console.log(`Found ${users.length} login account(s): ${toDelete.length} demo to remove, ${toKeep.length} kept.\n`);

  if (toKeep.length) {
    console.log("KEEP:");
    for (const u of toKeep) console.log(`  ✓ ${u.email}`);
    console.log("");
  }

  if (!toDelete.length) {
    console.log("Nothing to delete. Done.");
    return;
  }

  console.log(apply ? "DELETING:" : "WOULD DELETE:");
  for (const u of toDelete) console.log(`  ${apply ? "✗" : "-"} ${u.email}`);
  console.log("");

  if (!apply) {
    console.log("Dry run — nothing changed. Re-run with --apply to delete the above.");
    return;
  }

  let deleted = 0;
  for (const u of toDelete) {
    await ddbDoc.send(new DeleteCommand({ TableName: TABLE, Key: { PK: u.PK, SK: u.SK } }));
    deleted++;
  }
  console.log(`Deleted ${deleted} demo login account(s). Kept ${toKeep.length}.`);
  console.log("Reminder: also rotate any shared password and replace fixture corpora (runbook §5.3).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
