// Inline "What happens when I publish?" disclosure, shown on each review card
// just above Save & publish. Answers the two questions reviewers ask at the
// point of action — what does publishing do, and what gets stored — without
// leaving the queue. A fuller version lives at /extract/guide (linked below).
//
// Presentational only: native <details> (no hooks, no "use client"), so it
// renders inside the client FlaggedFieldsEditor without pulling in client JS of
// its own. Copy is imported from validation-display.ts so this and the guide
// page can never drift.
import Link from "next/link";
import { PUBLISH_SUMMARY, PUBLISH_STEPS, PUBLISH_STORED_DETAIL } from "@/lib/rap/validation-display";

export function PublishExplainer() {
  return (
    <details className="rounded border border-line bg-panel/60 text-sm group/pub">
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-center gap-2 p-2 text-ink2">
        <span aria-hidden className="text-ink3 text-xs transition-transform group-open/pub:rotate-90">▸</span>
        <span className="font-medium">What happens when I publish?</span>
      </summary>

      <div className="px-3 pb-3 pt-1 space-y-2 text-ink2">
        <p>{PUBLISH_SUMMARY}</p>
        <ul className="list-disc pl-5 space-y-1 text-ink3">
          {PUBLISH_STEPS.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>

        <details className="rounded border border-line bg-panel/60 group/stored">
          <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-center gap-2 p-2 text-ink3 text-xs">
            <span aria-hidden className="transition-transform group-open/stored:rotate-90">▸</span>
            <span className="font-medium uppercase tracking-wide">Exactly what's stored</span>
          </summary>
          <ul className="list-disc pl-5 pr-3 pb-3 pt-1 space-y-1 text-ink3 text-xs">
            {PUBLISH_STORED_DETAIL.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </details>

        <p className="text-ink3 text-xs">
          Full walkthrough:{" "}
          <Link href="/extract/guide" target="_blank" className="text-cedar underline">
            Reviewer guide ↗
          </Link>
        </p>
      </div>
    </details>
  );
}
