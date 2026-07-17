// ===========================================================================
// DIAGNOSTIC (not a fix): where does Option B's output budget actually go?
//
// docs/rap-extraction-findings.md §4 claims the per-subfield grounded schema
// exhausts the output budget. But its own diagnostic says output_tokens=8192
// for ~2,200 chars (~800 tokens) of JSON — ~90% of the budget unaccounted for.
// pipeline.bedrock.ts's stream loop captures ONLY input_json_delta and silently
// drops every other event type, which is precisely why nobody knows.
//
// This reproduces the real call shape and logs EVERY event type + usage, so the
// budget is accounted for rather than assumed.
//
//   AWS_PROFILE=isb npx tsx diag-truncation.ts
// ===========================================================================
import { BedrockRuntimeClient, InvokeModelWithResponseStreamCommand } from "@aws-sdk/client-bedrock-runtime";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { CLAUDE_TOOL, EXTRACTION_SYSTEM, EXTRACTION_TOOL_NAME } from "../src/lib/rap/extraction-schema";

const region = process.env.DIAG_REGION ?? "us-east-1";
const modelId = process.env.DIAG_MODEL ?? "anthropic.claude-sonnet-4-6";
const MAX_OUTPUT_TOKENS = Number(process.env.DIAG_MAX_TOKENS ?? 16000);

// A synthetic RAP with many commitments — the shape that triggers the bug.
// Deliberately text, so Textract/S3 are out of the picture and we isolate the
// Bedrock call itself.
function syntheticRap(nCommitments: number): string {
  const header = `ACME RESOURCES LIMITED
Reconciliation Action Plan 2026-2029
Published: 15 January 2026. Jurisdiction: Canada. RAP type: Stretch.
This plan covers the period 1 January 2026 to 31 December 2029.
Our review cycle is every three years. Sector: mining and resources.
Endorsed by the Board. Contact: reconciliation@acme.example.
`;
  const commitments = Array.from({ length: nCommitments }, (_, i) => {
    const n = i + 1;
    return `
Commitment ${n}. Action: Increase Indigenous procurement spend in category ${n} by ${n * 2} percent.
Deliverable: A published category-${n} procurement report. Target: $${n}.${n} million by Q4 2027.
Owner: Director of Procurement. Timeline: 31 December 2027. Pillar: opportunities.
Measured by: annual spend audited against the category-${n} baseline of $${n}00,000.`;
  }).join("\n");
  return header + commitments;
}

async function main() {
  const nCommitments = Number(process.env.DIAG_COMMITMENTS ?? 22);
  const documentText = syntheticRap(nCommitments);

  const body = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: MAX_OUTPUT_TOKENS,
    system: EXTRACTION_SYSTEM,
    tools: [CLAUDE_TOOL],
    tool_choice: { type: "tool", name: EXTRACTION_TOOL_NAME },
    messages: [
      {
        role: "user",
        content: `Extract the RAP fields from this document.\n\n<document filename="acme-rap.txt">\n${documentText}\n</document>`,
      },
    ],
  };

  console.log(`region=${region} model=${modelId} max_tokens=${MAX_OUTPUT_TOKENS} commitments=${nCommitments}`);
  console.log(`tool schema JSON size: ${JSON.stringify(CLAUDE_TOOL).length} chars`);
  console.log(`document size: ${documentText.length} chars\n`);

  const client = new BedrockRuntimeClient({
    region,
    requestHandler: new NodeHttpHandler({ requestTimeout: 300_000, connectionTimeout: 10_000 }),
  });

  const t0 = Date.now();
  (globalThis as any).__t0 = t0;
  const res = await client.send(
    new InvokeModelWithResponseStreamCommand({ modelId, contentType: "application/json", body: JSON.stringify(body) }),
  );

  // Account for EVERY event, not just the one the pipeline keeps.
  const eventCounts: Record<string, number> = {};
  const blockTypes: Record<string, number> = {};
  const charsByChannel: Record<string, number> = {};
  let toolJson = "";
  let stopReason = "";
  let usage: any = null;

  let lastDeltaAt = t0;
  let gaps: number[] = [];
  try {
  for await (const event of res.body ?? []) {
    const nowT = Date.now();
    gaps.push(nowT - lastDeltaAt);
    lastDeltaAt = nowT;
    const bytes = event.chunk?.bytes;
    if (!bytes) continue;
    const evt = JSON.parse(new TextDecoder().decode(bytes));
    eventCounts[evt.type] = (eventCounts[evt.type] ?? 0) + 1;

    if (evt.type === "content_block_start") {
      const t = evt.content_block?.type ?? "?";
      blockTypes[t] = (blockTypes[t] ?? 0) + 1;
    }
    if (evt.type === "content_block_delta") {
      const dt = evt.delta?.type ?? "?";
      // Measure every delta channel — this is the whole point.
      const payload =
        evt.delta?.partial_json ?? evt.delta?.text ?? evt.delta?.thinking ?? evt.delta?.signature ?? "";
      charsByChannel[dt] = (charsByChannel[dt] ?? 0) + String(payload).length;
      if (dt === "input_json_delta") toolJson += evt.delta.partial_json ?? "";
    }
    if (evt.type === "message_delta") {
      if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason;
      if (evt.usage) usage = { ...usage, ...evt.usage };
    }
    if (evt.type === "message_start" && evt.message?.usage) usage = { ...usage, ...evt.message.usage };
  }
  } catch (streamErr: any) {
    const el = ((Date.now() - t0) / 1000).toFixed(1);
    const maxGap = gaps.length ? Math.max(...gaps) : 0;
    console.log(`\n--- STREAM DIED after ${el}s ---`);
    console.log(`error: ${streamErr?.name}: ${streamErr?.message}`);
    console.log(`accumulated tool JSON at death: ${toolJson.length} chars (~${Math.round(toolJson.length/2.83)} tokens)`);
    console.log(`deltas received: ${gaps.length}, largest gap between chunks: ${maxGap}ms`);
    console.log(`=> if output kept flowing right up to the death, it is a TIME/connection wall, not a model stall.`);
    process.exit(2);
  }

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`--- RESULT (${secs}s) ---`);
  console.log(`stop_reason: ${stopReason}`);
  console.log(`usage: ${JSON.stringify(usage)}`);
  console.log(`\nevent type counts:`, eventCounts);
  console.log(`content block types:`, blockTypes);
  console.log(`chars per delta channel:`, charsByChannel);

  const outTok = usage?.output_tokens ?? 0;
  const estTok = Math.round(toolJson.length / 3.2); // JSON ~3.2 chars/token
  console.log(`\n--- BUDGET ACCOUNTING (the question) ---`);
  console.log(`captured tool JSON: ${toolJson.length} chars ≈ ${estTok} tokens`);
  console.log(`reported output_tokens: ${outTok}`);
  console.log(`unaccounted: ${outTok - estTok} tokens (${outTok ? (((outTok - estTok) / outTok) * 100).toFixed(0) : 0}%)`);
  if (outTok && estTok / outTok > 0.7) {
    console.log(`=> budget IS the JSON. The findings doc's root cause holds.`);
  } else {
    console.log(`=> budget is NOT the JSON. Something else consumed it — see channels above.`);
  }

  try {
    const parsed = JSON.parse(toolJson);
    console.log(`\nparsed OK. commitments returned: ${parsed?.commitments?.length ?? "?"} / ${nCommitments}`);
  } catch {
    console.log(`\ntool JSON did NOT parse (truncated). tail: …${toolJson.slice(-120)}`);
  }
}

main().catch((e) => {
  const el = (globalThis as any).__t0 ? ((Date.now() - (globalThis as any).__t0) / 1000).toFixed(1) : "?";
  console.error(`DIAG FAILED after ${el}s:`, e?.name, e?.message);
  process.exit(1);
});
