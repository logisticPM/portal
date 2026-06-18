// Runnable entry for the seed loader.
//   Local:  npm run ddb:seed
//   Cloud:  AWS_REGION=ca-central-1 DYNAMO_TABLE=DataPortal tsx scripts/seed.ts
import { seedAll } from "../src/lib/seed/seed";

async function main() {
  const n = await seedAll();
  console.log(
    `✅ seeded ${n.parties} parties, ${n.lines} lines, ${n.confirmations} confirmations, ${n.users} users`,
  );
}

main().catch((e) => {
  console.error("❌ seed failed:", e);
  process.exit(1);
});
