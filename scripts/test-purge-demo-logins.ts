// Assertions for the pure partition logic in purge-demo-logins.ts.
//   npx tsx scripts/test-purge-demo-logins.ts
import { partitionDemoUsers } from "./purge-demo-logins";

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? "ok  " : "FAIL"} — ${name}`);
  if (!cond) failures++;
}

const u = (email: string) => ({ email, PK: `USER#${email}`, SK: "USER" });

const users = [
  u("atb-financial@demo"),
  u("bc-hydro@demo"),
  u("institute@demo"),
  u("real-staff@indigenomics.ca"), // a real (non-demo) login — must never be touched
  u("ATCO@DEMO"), // case-insensitivity
];

// Default keep (institute@demo only): purge the demo companies, keep institute + real user.
{
  const { toDelete, toKeep } = partitionDemoUsers(users, ["institute@demo"]);
  const del = new Set(toDelete.map((x) => x.email));
  check("purges demo company logins", del.has("atb-financial@demo") && del.has("bc-hydro@demo"));
  check("keeps institute@demo", !del.has("institute@demo"));
  check("never touches a real (non-@demo) login", !del.has("real-staff@indigenomics.ca"));
  check("keep-list total = institute + real user", toKeep.length === 2);
  check("case-insensitive: ATCO@DEMO is purged", del.has("ATCO@DEMO"));
}

// Extra keep-list: additionally protect one demo company.
{
  const { toDelete } = partitionDemoUsers(users, ["institute@demo", "bc-hydro@demo"]);
  const del = new Set(toDelete.map((x) => x.email));
  check("extra keep protects bc-hydro@demo", !del.has("bc-hydro@demo"));
  check("still purges atb-financial@demo", del.has("atb-financial@demo"));
}

// Empty input.
{
  const { toDelete, toKeep } = partitionDemoUsers([], ["institute@demo"]);
  check("empty input → nothing to delete/keep", toDelete.length === 0 && toKeep.length === 0);
}

console.log(failures === 0 ? "\nAll passed." : `\n${failures} FAILED.`);
process.exit(failures === 0 ? 0 : 1);
