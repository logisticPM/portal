import Link from "next/link";
import { notFound } from "next/navigation";
import { casesRepo } from "@/lib/cases";
import { getBrief } from "@/lib/cases/briefs/repo";
import type { LegalCase } from "@/lib/cases";
import { isAdviceSeeking } from "@/lib/cases/briefs/advice";
import { themeLabel } from "@/lib/cases/labels";

export const dynamic = "force-dynamic";
const STALE_MS = 5 * 60_000;

export default async function BriefingPage({ params }: { params: { id: string } }) {
  const b = await getBrief(params.id);
  if (!b) notFound();
  const adviceBanner = isAdviceSeeking(b.question) ? (
    <p className="rounded border border-amber/40 bg-amber/10 px-3 py-2 text-sm text-ink2">
      This question reads as asking about a specific situation. The assistant provides{" "}
      <strong>general legal information, not advice</strong> — for advice, consult qualified
      counsel or an Indigenous legal clinic.
    </p>
  ) : null;
  // Display-only stale cutoff: a brief whose worker died without writing status
  // stays "pending" in Dynamo (quota already spent, not refunded) but renders as
  // unavailable after 5 min. A real build would add a TTL sweep / status write.
  const stalePending = b.status === "pending" && Date.now() - Date.parse(b.createdAt) > STALE_MS;

  if (b.status === "pending" && !stalePending) {
    return (
      <div className="mx-auto max-w-3xl space-y-3">
        <meta httpEquiv="refresh" content="4" />
        {adviceBanner}
        <h1 className="font-serif text-2xl">Generating briefing…</h1>
        <p className="text-sm text-ink3">&ldquo;{b.question}&rdquo;</p>
        <p className="text-sm text-ink3">Retrieving precedents and drafting — this usually takes 30–60 seconds. The page refreshes automatically.</p>
      </div>
    );
  }
  if (b.status === "failed" || stalePending) {
    return (
      <div className="mx-auto max-w-3xl space-y-3">
        {adviceBanner}
        <h1 className="font-serif text-2xl">Briefing unavailable</h1>
        <p className="text-sm text-ink3">&ldquo;{b.question}&rdquo;</p>
        <p className="rounded border border-line bg-amber/10 px-3 py-2 text-sm text-ink2">{b.failReason ?? "Generation did not complete."}</p>
        <Link href="/cases/briefings" className="text-sm text-amber hover:underline">← Ask again</Link>
      </div>
    );
  }

  const body = b.body!;
  const caseMap = new Map<string, LegalCase>();
  const ids = [...new Set([...body.precedents.map((p) => p.caseId), ...body.principles.flatMap((p) => p.caseIds)])];
  for (const c of await Promise.all(ids.map((id) => casesRepo.getCase(id)))) if (c) caseMap.set(c.id, c);
  const nameOf = (id: string) => caseMap.get(id)?.styleOfCause ?? id;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {adviceBanner}
      <div>
        <div className="text-amber text-xs uppercase tracking-widest mb-1">Briefing note</div>
        <h1 className="font-serif text-2xl">{b.question}</h1>
        <p className="mt-2 rounded border border-line bg-amber/10 px-3 py-2 text-xs text-ink2">
          <strong>AI-generated legal information · not legal advice.</strong> For advice about
          a specific situation, consult qualified counsel or an Indigenous legal clinic. Every
          precedent below links to its case page — verify each point there (case summaries
          carry paragraph-level anchors).
        </p>
      </div>
      <section>
        <h2 className="font-serif text-lg">Background</h2>
        <p className="text-sm text-ink2">{body.background}</p>
      </section>
      <section>
        <h2 className="font-serif text-lg">Precedents</h2>
        <div className="mt-2 space-y-3">
          {body.precedents.map((p) => {
            const c = caseMap.get(p.caseId);
            return (
              <div key={p.caseId} className="rounded border border-line bg-panel p-4">
                <Link href={`/cases/${p.caseId}`} className="font-serif hover:text-amber hover:underline">
                  {c ? `${c.styleOfCause} (${c.court}, ${c.year})` : p.caseId}
                </Link>
                {c && c.themes.length > 0 && <span className="ml-2 text-xs text-ink3">{c.themes.map(themeLabel).join(" · ")}</span>}
                <p className="mt-1 text-sm text-ink2">{p.establishes}</p>
                <p className="mt-1 text-xs text-ink3">Why it matters here: {p.relevance}</p>
              </div>
            );
          })}
        </div>
      </section>
      {body.principles.length > 0 && (
        <section>
          <h2 className="font-serif text-lg">Principles across the cases</h2>
          <ul className="mt-1 space-y-2 text-sm text-ink2">
            {body.principles.map((pr, i) => (
              <li key={i}>{pr.text}{" "}
                <span className="text-xs text-ink3">[{pr.caseIds.map((id, j) => (
                  <span key={id}>{j > 0 && "; "}<Link href={`/cases/${id}`} className="text-amber hover:underline">{nameOf(id)}</Link></span>
                ))}]</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h2 className="font-serif text-lg">Considerations</h2>
        <p className="text-sm text-ink2">{body.considerations}</p>
      </section>
      <p className="border-t border-line pt-3 text-xs text-ink3">
        Grounded in {b.retrievedCaseIds.length} retrieved cases from the curated core · model: {b.model} ·{" "}
        {b.createdAt.slice(0, 10)} · <Link href="/cases/briefings" className="text-amber hover:underline">all briefings</Link>
      </p>
    </div>
  );
}
