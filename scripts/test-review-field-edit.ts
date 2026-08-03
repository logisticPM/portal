// Pure field-edit logic for the review queue: the control registry (which fields
// are dropdowns vs text, and the pillarRaw→pillarNormalized redirect) and
// applyFieldEdits (writes reviewer corrections back onto an ExtractedRap without
// mutating it, respecting Grounded vs scalar targets).
//
// Run: npx tsx scripts/test-review-field-edit.ts
import {
  applyFieldEdits,
  controlForKey,
  editableField,
  readValueAt,
} from "../src/lib/rap/field-edit";
import type { ExtractedRap, Grounded } from "../src/lib/rap/types";

let fail = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`);
  if (!ok) fail++;
}

const g = <T,>(value: T | null, quote: string | null = null, page: number | null = null): Grounded<T> => ({
  value,
  quote,
  page,
  confidence: 0.5,
  flagged: true,
});

const make = (): ExtractedRap =>
  ({
    sector: g<string>("energy", "Hydro-Québec launched", 4),
    endorsementStatus: g<string>("released", "TMX Group announced", 1),
    frameworkRefs: g<string[]>(["undrip", "pair"], "Inspired by", 3),
    commitments: [
      { pillarRaw: g<string>("Pillar 1: Capital Realignment", "Pillar 1", 1), pillarNormalized: null, owner: g<string>("TMX Group", "said", 1) },
    ],
  }) as unknown as ExtractedRap;

// --- control registry -------------------------------------------------------
check("free-text field defaults to text control", controlForKey("owner").control === "text");
check("sector is an enum dropdown", controlForKey("sector").control === "enum");
check("pillarRaw is an enum that edits pillarNormalized",
  controlForKey("pillarRaw").control === "enum" && controlForKey("pillarRaw").editKey === "pillarNormalized");
check("frameworkRefs is enum-multi", controlForKey("frameworkRefs").control === "enum-multi");
check("periodCovered is a period control", controlForKey("periodCovered").control === "period");

// --- editableField descriptor ----------------------------------------------
const pillar = editableField(make(), "commitments[0].pillarRaw", "quote_not_found")!;
check("pillar descriptor edits the normalized path",
  pillar.editPath === "commitments[0].pillarNormalized", pillar.editPath);
check("pillar descriptor labels the card from the raw field", pillar.label === "Commitment 1 · Pillar", pillar.label);
check("pillar options are the canonical pillar set with labels",
  !!pillar.options && pillar.options.some((o) => o.value === "economy" && o.label === "Economy"));
check("pillar currentValue reads pillarNormalized (null here)", pillar.currentValue === null);
check("pillar card still shows the raw wording as evidence", pillar.quote === "Pillar 1" && pillar.page === 1);

const sector = editableField(make(), "sector", "quote_not_found")!;
check("sector descriptor edits itself", sector.editPath === "sector");
check("sector currentValue is the enum value", sector.currentValue === "energy");
check("sector options are labelled", !!sector.options && sector.options.some((o) => o.value === "energy" && o.label === "Energy"));

const fw = editableField(make(), "frameworkRefs", "quote_not_found")!;
check("frameworkRefs currentValue is the array", Array.isArray(fw.currentValue) && (fw.currentValue as string[]).length === 2);
check("frameworkRefs options carry full-name labels",
  !!fw.options && fw.options.some((o) => o.value === "undrip" && o.label.includes("UNDRIP")));

check("$document is not an editable field", editableField(make(), "$document", "source_text_damaged") === null);

// --- readValueAt ------------------------------------------------------------
check("readValueAt reads a Grounded value", readValueAt(make(), "sector") === "energy");
check("readValueAt reads a scalar (pillarNormalized)", readValueAt(make(), "commitments[0].pillarNormalized") === null);
check("readValueAt on unknown path is null", readValueAt(make(), "nope") === null);

// --- applyFieldEdits --------------------------------------------------------
const base = make();
const edited = applyFieldEdits(base, [
  { path: "commitments[0].owner", value: "TMX Group Limited" }, // free text → Grounded .value
  { path: "sector", value: "finance" }, // enum → Grounded .value
  { path: "commitments[0].pillarNormalized", value: "economy" }, // scalar set directly
]);
check("free-text edit lands on the Grounded value", edited.commitments[0].owner.value === "TMX Group Limited");
check("enum edit lands as the canonical value", edited.sector.value === "finance");
check("pillar edit writes the scalar pillarNormalized", edited.commitments[0].pillarNormalized === "economy");
check("pillarRaw (evidence) is left untouched", edited.commitments[0].pillarRaw.value === "Pillar 1: Capital Realignment");
check("unknown edit path is a no-op", applyFieldEdits(base, [{ path: "ghost", value: "x" }]).sector.value === "energy");
check("applyFieldEdits does not mutate its input", base.sector.value === "energy" && base.commitments[0].owner.value === "TMX Group");

console.log(fail === 0 ? "\nall passed" : `\n${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
