// Which model ids can this account actually invoke? `aws bedrock list-inference-profiles`
// reporting ACTIVE is NOT the same thing — this project has already had a plan blocked by two
// EOL Claude ids and one profile that was listed ACTIVE but not available to this account.
// The only reliable test is a real Converse call, so this makes one, with a one-token budget.
//
// Ops-only. No product code imports this.
import { modelFromId } from "../src/lib/cases/ingest/llm";

// Candidates, not a recommendation. The three ids already spoken for by other roles
// (llama3-3-70b = answerer, opus-4-5 = judge, sonnet-4-6 = writer) are included so the output
// doubles as a re-confirmation that they still work.
const DEFAULT_CANDIDATES = [
  "us.anthropic.claude-sonnet-4-6",
  "us.anthropic.claude-opus-4-5-20251101-v1:0",
  "us.meta.llama3-3-70b-instruct-v1:0",
  "us.amazon.nova-pro-v1:0",
  "us.amazon.nova-lite-v1:0",
  "mistral.mistral-large-2407-v1:0",
  "cohere.command-r-plus-v1:0",
  "us.meta.llama4-maverick-17b-instruct-v1:0",
  "us.deepseek.r1-v1:0",
];

async function main() {
  const ids = (process.env.PROBE_MODELS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const candidates = ids.length ? ids : DEFAULT_CANDIDATES;
  console.log(`probing ${candidates.length} candidate model id(s) with a real 1-token Converse call\n`);
  const ok: string[] = [];
  for (const id of candidates) {
    // Uncached on purpose: a cached "yes" from a previous probe would not prove the id is
    // invocable NOW, which is the only thing this script exists to establish.
    try {
      await modelFromId(id, { maxTokens: 1 }).call("hi");
      console.log(`  INVOCABLE   ${id}`);
      ok.push(id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // A max_tokens truncation means the call REACHED the model and it started generating —
      // that is a success for this probe, not a failure. llm.ts throws on truncation with no
      // text part, which is exactly what a 1-token budget produces.
      if (/truncated at maxTokens/.test(msg)) {
        console.log(`  INVOCABLE   ${id}   (reached the model; truncated at 1 token as expected)`);
        ok.push(id);
      } else {
        console.log(`  no          ${id}\n                ${msg.slice(0, 160)}`);
      }
    }
  }
  console.log(`\n${ok.length} invocable:\n${ok.map((i) => `  ${i}`).join("\n")}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
