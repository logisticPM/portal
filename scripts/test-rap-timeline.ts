// A RAP commitment's timeline is often a CADENCE ("Annual", "Ongoing", "Every
// three years"), not a due date — and parseDueDate can only produce a date.
//
// Two bugs followed from treating those as the same thing:
//   1. DATA LOSS. buildCanonical wrote only `dueDate: parseDueDate(timeline)`,
//      so "Annual" became null and the word was destroyed at publish time. The
//      extraction captured it faithfully (quote + page + confidence) and the
//      canonical row then said "no timeline". Note `metric` two lines above
//      keeps BOTH targetText (raw) and targetValue (parsed) — timeline kept
//      only the parse. This asymmetry was the bug.
//   2. A legitimate cadence was reported as a malformed date, which flags the
//      field and makes isClean() false — so a RAP full of "Annual" commitments
//      could never auto-publish (latent: REVIEW_MODE defaults to review).
//
// Run: npx tsx scripts/test-rap-timeline.ts
import { buildCanonical, isRecurringTimeline, parseDueDate } from "../src/lib/rap/publish";
import { validateAndFlag } from "../src/lib/rap/validate";
import type { ExtractedRap, Grounded } from "../src/lib/rap/types";

let fail = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  if (!ok) fail++;
}

const g = <T>(value: T, quote: string | null = "q"): Grounded<T> =>
  ({ value, quote, page: 1, confidence: 0.99, flagged: false }) as Grounded<T>;

const commit = (timeline: string | null) =>
  ({
    pillarRaw: g("theme"),
    pillarNormalized: "governance",
    action: g("Host an annual Indigenous inclusion event"),
    deliverable: g("event"),
    timeline: g(timeline),
    owner: g(null, null),
    metric: g("1 event"),
    commitmentType: g("cultural_learning"),
  }) as any;

const rap = (timeline: string | null): ExtractedRap =>
  ({
    orgName: g("Bank of Canada"), sector: g("finance"), jurisdiction: g("CA"), rapTitle: g("RAP"),
    publicationDate: g("2024"), periodCovered: g({ start: "2024", end: "2027" }),
    frameworkRefs: g(["trc_cta_92"]), pillars: ["governance"], governanceBody: g(null, null),
    reviewCycle: g(null, null), rapType: g(null, null), pairLevel: g(null, null),
    endorsementStatus: g(null, null), commitments: [commit(timeline)], sectorFields: {}, extras: [],
  }) as unknown as ExtractedRap;

const build = (timeline: string | null) =>
  buildCanonical(rap(timeline), { orgId: "o1", rapId: "r1", commitId: (i) => `c${i}` }, {
    sourceS3Key: "s3://x", extractionId: "e1", now: "2026-07-17T00:00:00Z",
    reviewedBy: "system:auto", dataClass: "org_submitted",
  }).commitments[0];

// --- 1. the data loss ------------------------------------------------------
const annual = build("Annual");
check("a cadence timeline SURVIVES publish as timelineText", annual.timelineText === "Annual");
check("  ...and dueDate is null, because a cadence is not a date", annual.dueDate === null);

const dated = build("by 2027");
check("a real date still parses into dueDate", dated.dueDate === "2027-12-31");
check("  ...and its raw text is kept too (mirrors targetText/targetValue)", dated.timelineText === "by 2027");

check("no timeline at all ⇒ both null, not a crash", build(null).timelineText === null && build(null).dueDate === null);

// --- 2. cadence is not a malformed date ------------------------------------
for (const t of ["Annual", "Annually", "Ongoing", "Every three years", "Quarterly", "Monthly", "Regular", "Continuous"])
  check(`"${t}" is recognised as a recurring timeline`, isRecurringTimeline(t));
for (const t of ["by 2027", "2025-06-30", "Q3 2026"])
  check(`"${t}" is a DATE, not a cadence`, !isRecurringTimeline(t) && parseDueDate(t) !== null);
// Garbage must still be caught — the check has to be able to fail.
for (const t of ["sometime", "asap", "TBD"])
  check(`"${t}" is neither a date nor a cadence (still a defect)`, !isRecurringTimeline(t) && parseDueDate(t) === null);

const issuesFor = (timeline: string | null) =>
  validateAndFlag(rap(timeline), { requireQuote: true }).issues.filter((i) => i.rule === "date_format");

check("a cadence does NOT raise date_format (it is a valid timeline)", issuesFor("Annual").length === 0);
check("  ...and the field is not flagged, so isClean() is not blocked", !validateAndFlag(rap("Annual"), { requireQuote: true }).extracted.commitments[0].timeline.flagged);
check("a real date does not raise date_format", issuesFor("by 2027").length === 0);
check("genuinely unparseable text STILL raises date_format", issuesFor("sometime").length === 1);

// publicationDate is a real date field — a cadence there is still an error.
const badPub: any = { ...rap("Annual"), publicationDate: g("Annually") };
check(
  "publicationDate still rejects a cadence (only timeline may recur)",
  validateAndFlag(badPub, { requireQuote: true }).issues.some((i) => i.rule === "date_format" && i.path === "publicationDate"),
);

process.exit(fail ? 1 : 0);
