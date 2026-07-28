/**
 * Re-run validation over a STORED extraction, without re-extracting.
 *
 * The expensive part of an extraction is the model calls (90s to several
 * minutes). Validation is pure. So when a validation rule changes, the honest
 * check is to replay the payload the model actually produced against the
 * document it was actually shown — which costs one PDF parse and no Bedrock
 * spend, and compares against the issues stored at the time.
 *
 * Usage:
 *   RAP_TABLE=<table> AWS_REGION=ca-central-1 AWS_PROFILE=<p> \
 *   JOB_ID=<id> PDF=<path> npx tsx scripts/replay-validation.ts
 */
import { readFileSync } from "node:fs";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../src/lib/dynamo/client";
import { buildTextFromPages, extractPagesFromPdf, scanFidelity } from "../src/lib/rap/doc-loader/textlayer";
import { validateAndFlag } from "../src/lib/rap/validate";
import type { ValidationIssue } from "../src/lib/rap/types";

const TABLE = process.env.RAP_TABLE;
const JOB_ID = process.env.JOB_ID;
const PDF = process.env.PDF;
if (!TABLE || !JOB_ID || !PDF) {
  console.error("RAP_TABLE, JOB_ID and PDF are all required");
  process.exit(1);
}

const key = (i: ValidationIssue) => `${i.path} · ${i.rule}`;

async function main() {
  const res = await ddbDoc.send(new GetCommand({ TableName: TABLE, Key: { PK: `EXTRACT#${JOB_ID}`, SK: "META" } }));
  const job = res.Item as any;
  if (!job?.extracted) throw new Error(`job ${JOB_ID} has no stored extraction`);

  // Rebuild the text the model was shown, the same way the pipeline does.
  const sourceText = scanFidelity(
    buildTextFromPages(await extractPagesFromPdf(new Uint8Array(readFileSync(PDF!)))),
  ).text;

  const stored: ValidationIssue[] = job.validationIssues ?? [];
  // requireQuote mirrors the engine: the claude/bedrock path grounds by quote,
  // BDA grounds by confidence and has no spans to check.
  const requireQuote = job.engine !== "bda";
  const replayed = validateAndFlag(job.extracted, { requireQuote, sourceText }).issues;

  const storedKeys = new Set(stored.map(key));
  const replayedKeys = new Set(replayed.map(key));
  const cleared = stored.filter((i) => !replayedKeys.has(key(i)));
  const added = replayed.filter((i) => !storedKeys.has(key(i)));

  console.log(`job ${JOB_ID}  (${job.fileName}, engine ${job.engine})`);
  console.log(`  stored issues:   ${stored.length}`);
  console.log(`  replayed issues: ${replayed.length}\n`);

  const byRule = (list: ValidationIssue[]) =>
    [...list.reduce((m, i) => m.set(i.rule, (m.get(i.rule) ?? 0) + 1), new Map<string, number>())]
      .map(([r, n]) => `${r}=${n}`)
      .join("  ") || "none";
  console.log(`  stored by rule:   ${byRule(stored)}`);
  console.log(`  replayed by rule: ${byRule(replayed)}\n`);

  if (cleared.length) {
    console.log(`  CLEARED (${cleared.length}) — flagged before, clean now:`);
    for (const i of cleared) console.log(`    - ${i.path} · ${i.rule}`);
  }
  if (added.length) {
    console.log(`  NEW (${added.length}) — clean before, flagged now:`);
    for (const i of added) console.log(`    + ${i.path} · ${i.rule}`);
  }
  if (replayed.length) {
    console.log(`\n  STILL FLAGGED (${replayed.length}):`);
    for (const i of replayed) console.log(`    ! ${i.path} · ${i.rule}`);
  }
}

main();
