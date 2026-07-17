// Unit test for the PURE functions in migrate-all-platform-tables.ts — NO
// AWS calls, NO DynamoDB Local needed. Importing migrate-all-platform-tables
// here must NOT trigger a real migration (RUN_MIGRATION is unset).
//
// Run: npx tsx scripts/test-migrate-orchestrator.ts
import { isPlatformTable, matchTableByStem, PLATFORM_STEMS } from "./migrate-all-platform-tables";

let fail = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  if (!ok) fail++;
}

// --- isPlatformTable ---------------------------------------------------

const realisticPlatformNames = [
  "indigenomics-portal-production-DataPortalTable-bddkwbku",
  "indigenomics-portal-production-RapDataTable-x8f2n3qz",
  "indigenomics-portal-production-RapSurveyTable-p9k1m7rt",
  "indigenomics-portal-production-CommitmentsTable-a1b2c3d4",
  "indigenomics-portal-production-AlignmentTable-z9y8x7w6",
];

for (const name of realisticPlatformNames) {
  check(`isPlatformTable: true for ${name}`, isPlatformTable(name) === true);
}

check(
  "isPlatformTable: false for LegalCases (bare stem)",
  isPlatformTable("LegalCases") === false
);
check(
  "isPlatformTable: false for realistic LegalCases physical name",
  isPlatformTable("indigenomics-portal-production-LegalCasesTable-x") === false
);
check(
  "isPlatformTable: false for lowercase legalcases",
  isPlatformTable("indigenomics-portal-production-legalcasestable-abcd1234") === false
);
check(
  "isPlatformTable: false for mixed-case LeGaLcAsEs",
  isPlatformTable("indigenomics-portal-production-LeGaLcAsEsTable-abcd1234") === false
);
check(
  "isPlatformTable: false for unrelated table name",
  isPlatformTable("some-other-unrelated-table") === false
);

// --- matchTableByStem ---------------------------------------------------

const usEast1Names = [
  "indigenomics-portal-production-DataPortalTable-bddkwbku",
  "indigenomics-portal-production-RapDataTable-x8f2n3qz",
  "indigenomics-portal-production-RapSurveyTable-p9k1m7rt",
  "indigenomics-portal-production-CommitmentsTable-a1b2c3d4",
  "indigenomics-portal-production-AlignmentTable-z9y8x7w6",
  "indigenomics-portal-production-LegalCasesTable-q1r2s3t4",
];

const caCentral1Names = [
  "indigenomics-portal-ca-DataPortalTable-nc7hd821",
  "indigenomics-portal-ca-RapDataTable-mv3jq902",
  "indigenomics-portal-ca-RapSurveyTable-tw5kd118",
  "indigenomics-portal-ca-CommitmentsTable-hb2fs661",
  "indigenomics-portal-ca-AlignmentTable-yl8pc340",
];

for (const stem of PLATFORM_STEMS) {
  const srcMatch = matchTableByStem(usEast1Names, stem);
  check(`matchTableByStem: finds ${stem} in us-east-1 list`, typeof srcMatch === "string" && srcMatch.includes(stem));

  const destMatch = matchTableByStem(caCentral1Names, stem);
  check(`matchTableByStem: finds ${stem} in ca-central-1 list`, typeof destMatch === "string" && destMatch.includes(stem));
}

check(
  "matchTableByStem: returns null when stem absent from the list",
  matchTableByStem(caCentral1Names, "NotARealStem") === null
);

check(
  "matchTableByStem: never returns the LegalCases table when searching a mixed list for a platform stem",
  PLATFORM_STEMS.every((stem) => {
    const match = matchTableByStem(usEast1Names, stem);
    return match === null || !match.toLowerCase().includes("legalcases");
  })
);

check(
  "matchTableByStem: refuses to return a LegalCases table even when the stem is literally 'LegalCases'",
  matchTableByStem(usEast1Names, "LegalCases") === null
);

check(
  "matchTableByStem: given a list containing ONLY LegalCases, a platform stem search finds nothing",
  matchTableByStem(["indigenomics-portal-production-LegalCasesTable-q1r2s3t4"], "DataPortal") === null
);

// --- guard test: PLATFORM_STEMS itself must never include LegalCases ----

check(
  "guard: PLATFORM_STEMS does not contain anything matching LegalCases",
  PLATFORM_STEMS.every((stem) => !stem.toLowerCase().includes("legalcases"))
);
check(
  "guard: PLATFORM_STEMS has exactly the five expected stems",
  PLATFORM_STEMS.length === 5 &&
    ["DataPortal", "RapData", "RapSurvey", "Commitments", "Alignment"].every((s) =>
      (PLATFORM_STEMS as readonly string[]).includes(s)
    )
);
check(
  "guard: every PLATFORM_STEMS entry independently passes isPlatformTable",
  PLATFORM_STEMS.every((stem) => isPlatformTable(stem) === true)
);
check(
  "guard: isPlatformTable('LegalCases') stays false even though it superficially resembles a stem",
  isPlatformTable("LegalCases") === false
);

process.exit(fail ? 1 : 0);
