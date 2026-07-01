// ===========================================================================
// Seed the SST-managed tables for the CURRENT stage — `npm run seed:sst`.
//
// The npm script wraps this in `sst shell`, which exposes the app's resources
// via the SST SDK (`Resource.DataPortal.name` / `Resource.RapSurvey.name`), so
// we never have to copy-paste the per-stage, auto-suffixed table names. Works
// the same against any stage (dev, deploy, a teammate's) — whatever `sst shell`
// is pointed at.
//
// IMPORTANT: client.ts and survey-table.ts read DYNAMO_TABLE / SURVEY_TABLE
// once, at module load. So we resolve the names into env FIRST, then pull in
// the seed loaders via dynamic import() — static imports would be hoisted and
// would capture the (wrong) default names before this code runs.
// ===========================================================================
import { Resource } from "sst";

async function main() {
  process.env.DYNAMO_TABLE = Resource.DataPortal.name;
  process.env.SURVEY_TABLE = Resource.RapSurvey.name;
  // Commitments is added to sst.config.ts; the generated Resource type catches up
  // after the next `sst deploy`/`sst dev`, so cast for the pre-deploy typecheck.
  process.env.COMMITMENTS_TABLE = (Resource as Record<string, { name: string }>).Commitments.name;
  process.env.AWS_REGION = process.env.AWS_REGION ?? "us-east-1";

  const { seedAll } = await import("../src/lib/seed/seed");
  const { seedSurvey } = await import("../src/lib/survey/seed");
  const { seedCommitments } = await import("./seed-commitments");

  const p = await seedAll();
  console.log(
    `✅ portal → ${process.env.DYNAMO_TABLE}: ${p.parties} parties, ${p.lines} lines, ${p.confirmations} confirmations`,
  );

  const s = await seedSurvey();
  console.log(
    `✅ survey → ${process.env.SURVEY_TABLE}: ${s.organizations} organizations, ${s.responses} responses`,
  );

  const cm = await seedCommitments();
  console.log(`✅ commitments → ${process.env.COMMITMENTS_TABLE}: ${cm.commitments} commitments`);
}

main().catch((e) => {
  console.error("❌ seed:sst failed:", e);
  process.exit(1);
});
