// ===========================================================================
// One-off: compute alignment opportunities over ALL existing commitments so the
// views aren't empty on day one (Streams handles new/updated thereafter).
//   npx sst shell --stage <stage> -- tsx scripts/seed-alignment.ts
//   (local: set the *_TABLE + DYNAMO_ENDPOINT env vars and run with tsx)
// ===========================================================================
import { Resource } from "sst";

// Resolve a table name from SST Resource when available (sst shell), else env
// (local DynamoDB-Local runs where Resource isn't populated).
function tableName(resourceName: "DataPortal" | "Commitments" | "Alignment", envVar: string): string {
  try {
    const r = (Resource as any)[resourceName];
    if (r?.name) return r.name as string;
  } catch {
    /* Resource not available (local run) */
  }
  const v = process.env[envVar];
  if (!v) throw new Error(`${envVar} not set and Resource.${resourceName} unavailable`);
  return v;
}

async function main() {
  process.env.REPO_IMPL = "dynamo"; // sst shell doesn't set this
  process.env.DYNAMO_TABLE = tableName("DataPortal", "DYNAMO_TABLE");
  process.env.COMMITMENTS_TABLE = tableName("Commitments", "COMMITMENTS_TABLE");
  process.env.ALIGNMENT_TABLE = tableName("Alignment", "ALIGNMENT_TABLE");
  process.env.AWS_REGION = process.env.AWS_REGION ?? "us-east-1";
  process.env.EMBED_PROVIDER = process.env.EMBED_PROVIDER ?? "stub";
  process.env.LABEL_MODELS = process.env.LABEL_MODELS ?? "stub:a,stub:b";

  const { computeForCommitment } = await import("../src/lib/alignment/engine");
  const { alignmentRepo } = await import("../src/lib/alignment");
  const { dynamoCommitmentsRepo } = await import("../src/lib/commitments/repo.dynamo");
  const { dynamoRepo } = await import("../src/lib/repo/repo.dynamo");

  const pool = await dynamoRepo.listParties("supplier");
  const commitments = (await dynamoCommitmentsRepo.listCommitments()).filter((c) => c.type === "procurement");
  let opps = 0;
  for (const c of commitments) {
    const kept = await computeForCommitment(c, pool, alignmentRepo);
    opps += kept.length;
  }
  console.log(`✅ alignment backfill: ${commitments.length} procurement commitments → ${opps} opportunities (pool: ${pool.length} suppliers)`);
}

main().catch((e) => {
  console.error("❌ seed-alignment failed:", e);
  process.exit(1);
});
