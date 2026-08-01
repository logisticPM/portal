// Pure display logic for the review queue's validation issues.
//
// The behaviour under test is the fix for reviewer confusion: a damaged PDF
// cascades into many `quote_not_found` flags whose root cause
// (`source_text_damaged`) must surface first and separately. These assertions
// pin the document/field split, the grouping that collapses N same-rule issues
// into one line, and the `hasDamage` signal the UI uses to explain the cascade.
//
// Run: npx tsx scripts/test-validation-display.ts
import {
  categoryForRule,
  plainLabel,
  summarizeIssues,
} from "../src/lib/rap/validation-display";
import type { ValidationIssue } from "../src/lib/rap/types";

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

// --- categoryForRule --------------------------------------------------------
check("source_text_damaged is document-level", categoryForRule("source_text_damaged") === "document");
check("low_page_coverage is document-level", categoryForRule("low_page_coverage") === "document");
check("quote_not_found is field-level", categoryForRule("quote_not_found") === "field");
check("date_format is field-level", categoryForRule("date_format") === "field");
check("cross_field is field-level", categoryForRule("cross_field") === "field");

// --- plainLabel -------------------------------------------------------------
check("plainLabel humanizes a known rule", plainLabel("quote_not_found") !== "quote_not_found");
check("plainLabel falls back to the code for anything unmapped",
  // cast to exercise the ?? branch without a real enum member
  plainLabel("mystery_rule" as ValidationIssue["rule"]) === "mystery_rule");

// --- summarizeIssues: the TMX-shaped cascade --------------------------------
// One damaged-document issue + several quote failures + one date_format.
const tmx: ValidationIssue[] = [
  issue("endorsementStatus", "quote_not_found"),
  issue("commitments[0].owner", "quote_not_found"),
  issue("commitments[1].owner", "quote_not_found"),
  issue("commitments[3].timeline", "date_format"),
  issue("$document", "source_text_damaged"),
];
const s = summarizeIssues(tmx);

check("document-level issues are split out", s.document.length === 1 && s.document[0].rule === "source_text_damaged");
check("field-level issues grouped by rule (2 groups: quote_not_found, date_format)", s.fieldGroups.length === 2);

const qGroup = s.fieldGroups.find((g) => g.rule === "quote_not_found")!;
check("quote_not_found group collapses the 3 fields into one line", qGroup.count === 3 && qGroup.paths.length === 3);
check("quote_not_found group lists the affected paths",
  qGroup.paths.join(",") === "endorsementStatus,commitments[0].owner,commitments[1].owner", qGroup.paths.join(","));
check("fieldCount counts every field-level issue (not document-level)", s.fieldCount === 4);
check("hasDamage true when source_text_damaged present", s.hasDamage === true);

// --- summarizeIssues: no damage --------------------------------------------
const clean = summarizeIssues([issue("commitments[0].timeline", "date_format")]);
check("hasDamage false without source_text_damaged", clean.hasDamage === false);
check("no document-level issues when none present", clean.document.length === 0);
check("single field group with one path", clean.fieldGroups.length === 1 && clean.fieldGroups[0].count === 1);

// --- summarizeIssues: empty + no-mutation -----------------------------------
const empty = summarizeIssues([]);
check("empty input yields empty summary",
  empty.document.length === 0 && empty.fieldGroups.length === 0 && empty.fieldCount === 0 && empty.hasDamage === false);

const before = tmx.length;
summarizeIssues(tmx);
check("summarizeIssues does not mutate its input", tmx.length === before);

console.log(fail === 0 ? "\nall passed" : `\n${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
