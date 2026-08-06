// Standalone reviewer guide for the extraction review queue. Linked from the
// queue header and from each card's inline "What happens when I publish?"
// disclosure. The prose here is the fuller version of that disclosure; the
// shared bullets come from validation-display.ts so the two never drift.
import Link from "next/link";
import { InstituteNav } from "@/components/InstituteNav";
import { PUBLISH_SUMMARY, PUBLISH_STEPS, PUBLISH_STORED_DETAIL, DATE_FIELD_NOTE } from "@/lib/rap/validation-display";

export const metadata = { title: "Reviewer guide · Extraction QA" };

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

        <section className="space-y-2">
          <h2 className="font-medium text-ink">3 · Exactly what's stored</h2>
          <ul className="list-disc pl-5 space-y-1 text-ink2 text-sm">
            {PUBLISH_STORED_DETAIL.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
          <div className="rounded border border-amber/30 bg-amber/5 p-3 text-ink2 text-sm">
            <span className="font-medium">Timelines and dates.</span> {DATE_FIELD_NOTE}
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
