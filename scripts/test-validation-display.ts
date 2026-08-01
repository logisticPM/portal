// Pure display logic for the review queue's validation issues.
//
// Two behaviours under test:
//  1. A damaged PDF cascades into many `quote_not_found` flags whose root cause
//     (`source_text_damaged`) must surface first and separately.
//  2. A bare path like `commitments[34].pillarRaw` is useless to a reviewer, so
//     each path resolves back to its extracted field (label + value + quote +
//     page) — the actual starting point for a manual check.
//
// Run: npx tsx scripts/test-validation-display.ts
import {
  categoryForRule,
  pathToField,
  plainLabel,
  summarizeIssues,
} from "../src/lib/rap/validation-display";
import type { ExtractedRap, Grounded, ValidationIssue } from "../src/lib/rap/types";

let fail = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`);
  if (!ok) fail++;
}

const issue = (path: string, rule: ValidationIssue["rule"], message = ""): ValidationIssue => ({
  path,
  rule,
  message,
});
const g = <T,>(value: T | null, quote: string | null, page: number | null): Grounded<T> => ({
  value,
  quote,
  page,
  confidence: 0.5,
  flagged: true,
});

// Minimal ExtractedRap covering only the fields the resolver reads. Cast because
// the full type is large; the resolver walks commitments[i][key] + top-level keys.
const extracted = {
  sector: g("energy", "Hydro-Québec launched its Action Plan", 1),
  endorsementStatus: g("endorsed", "TMX Group today announced", 2),
  frameworkRefs: g(["undrip", "pair"], "Inspired by these discussions", 3),
  commitments: [
    { owner: g("TMX Group", "TMX Group today announced", 2), pillarNormalized: "capital" },
    { owner: g("Board", "TMX Group today announced", 2) },
    {},
    { timeline: g("Up to 10-year planning horizon", "Up to 10-year", 12) },
  ],
} as unknown as ExtractedRap;

// --- categoryForRule --------------------------------------------------------
check("source_text_damaged is document-level", categoryForRule("source_text_damaged") === "document");
check("low_page_coverage is document-level", categoryForRule("low_page_coverage") === "document");
check("quote_not_found is field-level", categoryForRule("quote_not_found") === "field");
check("date_format is field-level", categoryForRule("date_format") === "field");

// --- plainLabel -------------------------------------------------------------
check("plainLabel humanizes a known rule", plainLabel("quote_not_found") !== "quote_not_found");
check("plainLabel falls back to the code for anything unmapped",
  plainLabel("mystery_rule" as ValidationIssue["rule"]) === "mystery_rule");

// --- pathToField ------------------------------------------------------------
const pillarLike = pathToField(extracted, "commitments[0].owner");
check("commitment path resolves to 1-based label", pillarLike?.label === "Commitment 1 · Owner", pillarLike?.label);
check("commitment path returns the extracted value", pillarLike?.g.value === "TMX Group");
check("commitment path carries the page", pillarLike?.page === 2);

const top = pathToField(extracted, "sector");
check("top-level path resolves with human label", top?.label === "Sector", top?.label);
check("top-level path returns value + page", top?.g.value === "energy" && top?.page === 1);
check("enum value is humanized in displayValue", top?.displayValue === "Energy", top?.displayValue);

const fw = pathToField(extracted, "frameworkRefs");
check("framework array renders full names with acronyms",
  fw?.displayValue === "UN Declaration on the Rights of Indigenous Peoples (UNDRIP), Partnership Accreditation in Indigenous Relations (PAIR)",
  fw?.displayValue);
check("plain-string field displayValue is the raw string",
  pillarLike?.displayValue === "TMX Group", pillarLike?.displayValue);

check("$document resolves to null", pathToField(extracted, "$document") === null);
check("unknown top-level key resolves to null", pathToField(extracted, "nonesuch") === null);
check("non-Grounded key (pillarNormalized) resolves to null",
  pathToField(extracted, "commitments[0].pillarNormalized") === null);
check("out-of-range commitment index resolves to null", pathToField(extracted, "commitments[99].owner") === null);

// --- summarizeIssues: the cascade, with resolution --------------------------
const tmx: ValidationIssue[] = [
  issue("endorsementStatus", "quote_not_found"),
  issue("commitments[0].owner", "quote_not_found"),
  issue("commitments[1].owner", "quote_not_found"),
  issue("commitments[3].timeline", "date_format"),
  issue("$document", "source_text_damaged"),
];
const s = summarizeIssues(tmx, extracted);

check("document-level issues are split out", s.document.length === 1 && s.document[0].rule === "source_text_damaged");
check("field-level issues grouped by rule (2 groups)", s.fieldGroups.length === 2);

const qGroup = s.fieldGroups.find((g) => g.rule === "quote_not_found")!;
check("quote_not_found group collapses the 3 fields", qGroup.count === 3 && qGroup.fields.length === 3);
check("group fields carry the original path",
  qGroup.fields.map((f) => f.path).join(",") === "endorsementStatus,commitments[0].owner,commitments[1].owner",
  qGroup.fields.map((f) => f.path).join(","));
check("group fields are resolved to their data",
  qGroup.fields.every((f) => f.resolved !== null) &&
  qGroup.fields[0].resolved?.label === "Endorsement status" &&
  qGroup.fields[1].resolved?.label === "Commitment 1 · Owner");
check("fieldCount counts every field-level issue", s.fieldCount === 4);
check("hasDamage true when source_text_damaged present", s.hasDamage === true);

// --- summarizeIssues without extracted (resolution optional) ----------------
const noExtract = summarizeIssues(tmx);
check("resolved is null when no extracted supplied",
  noExtract.fieldGroups.every((g) => g.fields.every((f) => f.resolved === null)));
check("paths still present without extracted",
  noExtract.fieldGroups.find((g) => g.rule === "quote_not_found")!.fields.length === 3);

// --- empty + no-mutation ----------------------------------------------------
const empty = summarizeIssues([]);
check("empty input yields empty summary",
  empty.document.length === 0 && empty.fieldGroups.length === 0 && empty.fieldCount === 0 && empty.hasDamage === false);

const before = tmx.length;
summarizeIssues(tmx, extracted);
check("summarizeIssues does not mutate its input", tmx.length === before);

console.log(fail === 0 ? "\nall passed" : `\n${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
