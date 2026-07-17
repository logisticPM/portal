// The split schemas must together cover exactly what the original did — no field
// silently lost when we stopped using one big tool.
// Run: npx tsx scripts/test-extraction-schema-split.ts
import { CLAUDE_TOOL, COMMITMENTS_TOOL, HEADER_TOOL } from "../src/lib/rap/extraction-schema";

let fail = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  if (!ok) fail++;
}

const props = (t: any) => Object.keys(t.input_schema.properties ?? {});
const original = props(CLAUDE_TOOL);
const header = props(HEADER_TOOL);
const commitments = props(COMMITMENTS_TOOL);

check("header tool has NO commitments field", !header.includes("commitments"));
check("commitments tool has ONLY commitments", commitments.length === 1 && commitments[0] === "commitments");
check(
  "header ∪ commitments === the original field set (nothing lost)",
  new Set([...header, ...commitments]).size === new Set(original).size &&
    original.every((f) => header.includes(f) || commitments.includes(f)),
);
check("header and commitments do not overlap", header.every((f) => !commitments.includes(f)));
check("the two tools have distinct names", HEADER_TOOL.name !== COMMITMENTS_TOOL.name);

// The grounding contract must survive the split.
const commitItem: any = (COMMITMENTS_TOOL.input_schema.properties as any).commitments.items;
const sub = Object.values(commitItem.properties ?? {}) as any[];
check(
  "every commitment sub-field is still a grounded {value,quote,page,confidence}",
  sub.length > 0 &&
    sub.every((f) => ["value", "quote", "page", "confidence"].every((k) => k in (f.properties ?? {}))),
);

process.exit(fail ? 1 : 0);
