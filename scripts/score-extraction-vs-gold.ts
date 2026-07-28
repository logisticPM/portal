// Scores a finished extraction job against the 22-entry gold commitment set
// for the Bank of Canada RAP. Page accuracy is the acceptance bar: the
// pre-work baseline already recovered gold ACTION text verbatim, but put it
// on page 12 where gold says 13, because pdf-parse's flat output left the
// model guessing pages. Finding the right commitments was never in doubt;
// grounding them was.
//
// Manual, not part of any suite — it reads a live DynamoDB job that only
// exists after a real deploy + extraction run (scripts/make-test-job.ts +
// a lambda invoke), the same reason scripts/test-layout-real-ocr.ts and
// measure-textlayer-parity.ts stay out of the automated suites. This is a
// DIAGNOSTIC: it reports counts and does not assert or exit non-zero on a
// poor score — a human reads the numbers and decides.
//
// Matching rule: gold action text vs. extracted action value is compared
// with normalizeForQuoteMatch (src/lib/rap/validate.ts), the SAME rule the
// pipeline itself uses to accept or flag a quote — not an ad-hoc lookalike.
// That distinction is not cosmetic here: the gold fixture is pure ASCII with
// straight apostrophes, while the source PDF's text layer carries real
// Unicode apostrophes (U+2019, e.g. "Bank's"). A naive literal/regex probe
// that doesn't fold those together undercounts (measured via
// measure-textlayer-parity.ts: 205/207 shared words, both misses being
// apostrophe words) where the pipeline's own tolerant rule matches cleanly.
//
// Run:
//   AWS_PROFILE=isb AWS_REGION=ca-central-1 \
//     RAP_TABLE=<table> JOB_ID=<jobId> npx tsx scripts/score-extraction-vs-gold.ts
import { readFileSync } from "node:fs";
import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { normalizeForQuoteMatch } from "../src/lib/rap/validate";

type Gold = { page: number; action: string };

const table = process.env.RAP_TABLE;
const jobId = process.env.JOB_ID;
if (!table || !jobId) {
  console.error("usage: RAP_TABLE=<table> JOB_ID=<jobId> npx tsx scripts/score-extraction-vs-gold.ts");
  console.error("  RAP_TABLE and JOB_ID are both required (env vars); missing:");
  if (!table) console.error("    RAP_TABLE");
  if (!jobId) console.error("    JOB_ID");
  process.exit(1);
}

async function main() {
  const gold = JSON.parse(
    readFileSync("scripts/fixtures/gold-commitments-bankofcanada.json", "utf8"),
  ) as Gold[];

  const ddb = new DynamoDBClient({ region: process.env.AWS_REGION ?? "ca-central-1" });
  const res = await ddb.send(
    new GetItemCommand({
      TableName: table,
      Key: { PK: { S: `EXTRACT#${jobId}` }, SK: { S: "META" } },
    }),
  );
  if (!res.Item) {
    console.error(`job ${jobId} not found in table ${table}`);
    process.exit(1);
  }
  const item = unmarshall(res.Item) as {
    extracted?: { commitments?: any[] };
    validationIssues?: any[];
  };
  const got = item.extracted?.commitments ?? [];

  let actionHits = 0;
  let pageHits = 0;
  const misses: string[] = [];
  for (const g of gold) {
    const goldNorm = normalizeForQuoteMatch(g.action);
    const match = got.find((c) => normalizeForQuoteMatch(String(c?.action?.value ?? "")).includes(goldNorm.slice(0, 40)));
    if (!match) {
      misses.push(g.action.slice(0, 60));
      continue;
    }
    actionHits++;
    if (Number(match.action?.page) === g.page) pageHits++;
  }

  console.log(`gold commitments:      ${gold.length}`);
  console.log(`extracted commitments: ${got.length}`);
  console.log(`action matches:        ${actionHits}/${gold.length}`);
  console.log("");
  console.log(`PAGE matches:          ${pageHits}/${gold.length}   <-- acceptance bar`);
  console.log("");
  console.log(`validation issues:     ${item.validationIssues?.length ?? 0}`);
  if (misses.length) console.log(`missed:\n  ${misses.join("\n  ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
