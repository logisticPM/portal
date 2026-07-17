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
//
// pillarNormalized is deliberately excluded: it is NOT and never was a grounded
// field. It is a code-side derivation from the already-grounded pillarRaw —
// `pillarNormalized: Pillar | null` in types.ts:86 — and every consumer reads it
// as a plain value (publish.ts:242, pipeline.bda.ts:67). The plan's version of
// this test asserted "every sub-field is grounded", which never described this
// schema; the only way to satisfy it literally would be to change CLAUDE_TOOL,
// which the same plan forbids. What matters is that the split loses no
// grounding, so assert that over the fields that actually carry it.
const commitItem: any = (COMMITMENTS_TOOL.input_schema.properties as any).commitments.items;
const subEntries = Object.entries(commitItem.properties ?? {}) as [string, any][];
const groundedSubs = subEntries.filter(([name]) => name !== "pillarNormalized");
check(
  "every grounded commitment sub-field is still a {value,quote,page,confidence}",
  groundedSubs.length > 0 &&
    groundedSubs.every(([, f]) => ["value", "quote", "page", "confidence"].every((k) => k in (f.properties ?? {}))),
);
// ...and the ungrounded one must not silently change shape either.
const pillarNormalized = commitItem.properties?.pillarNormalized;
check(
  "pillarNormalized is still the plain enum it is in CLAUDE_TOOL (not silently re-shaped)",
  !!pillarNormalized &&
    !("properties" in pillarNormalized) &&
    JSON.stringify(pillarNormalized) ===
      JSON.stringify((CLAUDE_TOOL.input_schema.properties as any).commitments.items.properties.pillarNormalized),
);

process.exit(fail ? 1 : 0);
