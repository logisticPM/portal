// Standalone reviewer guide for the extraction review queue. Linked from the
// queue header and from each card's inline "What happens when I publish?"
// disclosure. The prose here is the fuller version of that disclosure; the
// shared bullets come from validation-display.ts so the two never drift.
import Link from "next/link";
import { InstituteNav } from "@/components/InstituteNav";
import { PUBLISH_SUMMARY, PUBLISH_STEPS, PUBLISH_STORED_DETAIL, DATE_FIELD_NOTE } from "@/lib/rap/validation-display";

export const metadata = { title: "Reviewer guide · Extraction QA" };

// Extraction reads a fixed set of fields from the document; publishing writes a
// subset of them into three record types. Each row is [stored field, where it
// comes from]. Kept in sync with buildCanonical() in publish.ts — if that
// mapping changes, update these. Two transforms are worth calling out: a
// commitment's `metric` is kept as words AND parsed to a number; its `timeline`
// is kept as words AND parsed to a date.
const ORG_FIELDS: [string, string][] = [
  ["Organization name", "the AI's reading — replaced by the official legal name once the Business Number is resolved"],
  ["Sector", "sector (chosen from a fixed list)"],
  ["Region", "jurisdiction (Australia / Canada / other)"],
  ["Business Number, legal name, registry status", "the Business-Number resolution step — not the AI"],
  ["Size band", "derived automatically"],
];

const RAP_FIELDS: [string, string][] = [
  ["Title", "the RAP title"],
  ["RAP type", "Reflect / Innovate / Stretch / Elevate"],
  ["Jurisdiction", "jurisdiction"],
  ["Framework references", "UNDRIP, TRC Call to Action 92, OCAP®, PAIR (shown as badges on the RAP)"],
  ["Publication date", "the publication date"],
  ["Reporting period (start → end)", "the period covered, split into a start and an end date"],
  ["Source PDF, extraction ID, status, data class", "recorded automatically as provenance"],
];

const COMMITMENT_FIELDS: [string, string][] = [
  ["Pillar", "the document's pillar wording, mapped to a canonical pillar"],
  ["Type", "commitment type (chosen from a fixed list)"],
  ["Action", "the action"],
  ["Deliverable", "the deliverable"],
  ["Target (words) + target value (number)", "the metric — words kept as-is, and a number parsed out where possible"],
  ["Timeline (words) + due date", "the timeline — words kept as-is, and a real date parsed out where possible"],
  ["Owner", "the accountable owner (blank if the document names none)"],
  ["Source quote + page", "the grounding — the sentence and page the commitment came from"],
  ["Confidence, reviewer, claim basis", "recorded automatically as provenance"],
];

// Extracted and reviewable, retained on the raw extraction job, but NOT written
// into the published organization / RAP / commitment record today (no field for
// them in the canonical types — see publish.ts buildCanonical). Framework
// references used to be here; they are now persisted on the RAP document.
const CAPTURED_NOT_PUBLISHED: [string, string][] = [
  ["Governance body", "the RAP working group / board sponsor"],
  ["Review cycle", "annual / biennial / 3-year"],
  ["PAIR level", "CCIB PAIR accreditation level"],
  ["Endorsement status", "Reconciliation-Australia endorsement (AU documents)"],
];

function FieldTable({ rows }: { rows: [string, string][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border border-line">
        <thead>
          <tr className="bg-panel text-ink3 text-xs uppercase tracking-wide">
            <th className="text-left font-medium border-b border-line px-2 py-1 w-1/2">Stored field</th>
            <th className="text-left font-medium border-b border-line px-2 py-1">Comes from</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([field, source], i) => (
            <tr key={i} className="align-top">
              <td className="border-b border-line px-2 py-1 text-ink2 font-medium">{field}</td>
              <td className="border-b border-line px-2 py-1 text-ink3">{source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ReviewGuidePage() {
  return (
    <div className="space-y-6">
      <InstituteNav active="/extract" />

      <div className="max-w-3xl space-y-8">
        <header className="space-y-2">
          <div className="text-amber text-xs uppercase tracking-widest">Indigenomics · Extraction QA</div>
          <h1 className="font-serif text-2xl">How review &amp; publish works</h1>
          <p className="text-ink2 text-sm">
            Only documents the AI was unsure about reach the review queue — clean, high-confidence
            extractions publish automatically. Your job is to confirm the flagged fields against the
            source PDF, then publish.
          </p>
          <p className="text-ink3 text-sm">
            <Link href="/extract?tab=review" className="text-cedar underline">← Back to the review queue</Link>
          </p>
        </header>

        <section className="space-y-2">
          <h2 className="font-medium text-ink">1 · Verify each flagged field</h2>
          <p className="text-ink2 text-sm">
            Each flagged field shows what the AI read, the quote and page it was grounded on, and a
            box where you can correct the value. Open the source PDF to check it, fix anything wrong,
            then tick <span className="font-medium">Verified</span>. Ticking Verified records that
            you've looked — it does not save anything on its own, and it does not publish. You can't
            publish until every flagged field on the document is verified and its organization is
            resolved to a Business Number.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-medium text-ink">2 · What Save &amp; publish does</h2>
          <p className="text-ink2 text-sm">{PUBLISH_SUMMARY}</p>
          <ul className="list-disc pl-5 space-y-1 text-ink2 text-sm">
            {PUBLISH_STEPS.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="font-medium text-ink">3 · Exactly what's stored</h2>
          <ul className="list-disc pl-5 space-y-1 text-ink2 text-sm">
            {PUBLISH_STORED_DETAIL.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>

          <p className="text-ink2 text-sm">
            The AI reads a fixed set of fields from every document. On publish, those become
            three kinds of record — here is exactly which field each one fills in:
          </p>

          <div className="space-y-4">
            <div className="space-y-1">
              <h3 className="text-ink2 text-sm font-medium">
                The organization <span className="text-ink3 font-normal">— one record per company</span>
              </h3>
              <FieldTable rows={ORG_FIELDS} />
            </div>
            <div className="space-y-1">
              <h3 className="text-ink2 text-sm font-medium">
                The RAP document <span className="text-ink3 font-normal">— one record per document</span>
              </h3>
              <FieldTable rows={RAP_FIELDS} />
            </div>
            <div className="space-y-1">
              <h3 className="text-ink2 text-sm font-medium">
                Each commitment <span className="text-ink3 font-normal">— one record per commitment</span>
              </h3>
              <FieldTable rows={COMMITMENT_FIELDS} />
            </div>
          </div>

          <div className="rounded border border-amber/30 bg-amber/5 p-3 text-ink2 text-sm">
            <span className="font-medium">Timelines and dates.</span> {DATE_FIELD_NOTE}
          </div>

          <div className="rounded border border-line bg-panel/60 p-3 text-sm space-y-2">
            <div className="text-ink2 font-medium">Captured for review, but not in the published record yet</div>
            <p className="text-ink3">
              These fields are extracted and can be reviewed, and they're kept with the raw
              extraction, but they don't currently populate the published organization / RAP /
              commitment record that the portal displays and searches:
            </p>
            <FieldTable rows={CAPTURED_NOT_PUBLISHED} />
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="font-medium text-ink">If a document is wrong</h2>
          <p className="text-ink2 text-sm">
            Use <span className="font-medium">Reject</span> (with an optional reason) instead of
            publishing. Rejecting takes the document out of the queue without writing any record. If
            you publish and later spot a mistake, correct it and publish the same document again — the
            new version replaces the old one.
          </p>
        </section>
      </div>
    </div>
  );
}
