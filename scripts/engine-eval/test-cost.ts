// scripts/engine-eval/test-cost.ts
import { estimateCost } from "./cost";
let fail = 0;
function check(name: string, ok: boolean) { console.log(`${ok ? "✅" : "❌"} ${name}`); if (!ok) fail++; }

// textlayer: LLM only. 1M in @ $3 + 1M out @ $15 = $18
check("textlayer LLM cost", Math.abs(estimateCost("textlayer", 10, 1_000_000, 1_000_000) - 18) < 1e-6);
// textract adds $0.004/page: 100 pages → +$0.40
check("textract adds Textract per-page", Math.abs(estimateCost("textract", 100, 0, 0) - 0.4) < 1e-6);
// bda: $0.040/page only, no LLM token cost: 100 pages → $4
check("bda per-page only", Math.abs(estimateCost("bda", 100, 0, 0) - 4) < 1e-6);
process.exit(fail ? 1 : 0);
