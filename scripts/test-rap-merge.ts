// Run: npx tsx scripts/test-rap-merge.ts
import { mergeExtraction } from "../src/lib/rap/pipeline.bedrock";

let fail = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  if (!ok) fail++;
}
const g = (v: any) => ({ value: v, quote: "q", page: 1, confidence: 0.9 });
const commit = (a: string) => ({ action: g(a), deliverable: g("d") });

const header: any = { orgName: g("Acme"), sector: g("other"), commitments: undefined };
const merged: any = mergeExtraction(header, [[commit("a1"), commit("a2")], [commit("a3")]]);

check("header fields survive the merge", merged.orgName.value === "Acme");
check("all commitments from all chunks are present", merged.commitments.length === 3);
check(
  "commitments keep document order across chunks",
  merged.commitments.map((c: any) => c.action.value).join(",") === "a1,a2,a3",
);
check("an empty chunk group contributes nothing",
  (mergeExtraction(header, [[], [commit("x")]]) as any).commitments.length === 1);
check("no chunks → zero commitments, not a crash",
  (mergeExtraction(header, []) as any).commitments.length === 0);

process.exit(fail ? 1 : 0);
