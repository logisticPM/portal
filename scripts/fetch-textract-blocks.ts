/**
 * Fetch every block of a completed Textract analysis job and save them as JSON.
 *
 * Run under a human SSO session: the org SCP denies Textract to the account's
 * Lambda roles but not to SSO principals (docs/ca-extraction-textract-scp.md),
 * so this works in ca-central-1 — in country, no cross-border transfer — while
 * the deployed pipeline cannot call it at all.
 *
 * Usage: AWS_PROFILE=isb npx tsx scripts/fetch-textract-blocks.ts <jobId> <out.json> [region]
 */
import { writeFileSync } from "node:fs";
import { TextractClient, GetDocumentAnalysisCommand } from "@aws-sdk/client-textract";

const [jobId, out, region = "ca-central-1"] = process.argv.slice(2);
if (!jobId || !out) {
  console.error("usage: npx tsx scripts/fetch-textract-blocks.ts <jobId> <out.json> [region]");
  process.exit(1);
}

async function main() {
  const client = new TextractClient({ region });
  const blocks: any[] = [];
  let token: string | undefined;
  let pages = 0;
  do {
    const res: any = await client.send(
      new GetDocumentAnalysisCommand({ JobId: jobId, MaxResults: 1000, NextToken: token }),
    );
    if (res.JobStatus !== "SUCCEEDED") throw new Error(`job status: ${res.JobStatus}`);
    pages = res.DocumentMetadata?.Pages ?? pages;
    blocks.push(...(res.Blocks ?? []));
    token = res.NextToken;
    process.stderr.write(`  fetched ${blocks.length} blocks…\n`);
  } while (token);

  writeFileSync(out, JSON.stringify({ jobId, region, pages, blocks }));
  console.log(`${blocks.length} blocks over ${pages} pages -> ${out}`);
}

main();
