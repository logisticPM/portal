import Link from "next/link";
import { notFound } from "next/navigation";
import { casesRepo } from "@/lib/cases";
import { TierBadge, FullTextReader, ProvenanceFooter } from "../ui";

export default async function CaseDetail({
  params, searchParams,
}: { params: { id: string }; searchParams: { q?: string } }) {
  const c = await casesRepo.getCase(params.id);
  if (!c) notFound();
  const q = searchParams.q ?? "";
  const graph = await casesRepo.getCitationGraph(c.id);

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/cases" className="text-sm text-ink3 hover:text-amber hover:underline">← all cases</Link>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <h1 className="font-serif text-2xl">{c.styleOfCause}</h1>
        <TierBadge tier={c.corpusTier} fullTextAvailable={c.fullTextAvailable} />
      </div>
      <div className="text-sm text-ink3">{c.citation}{c.citation2 ? ` · ${c.citation2}` : ""} · {c.court} · {c.year}</div>
      {c.themes.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1 text-xs">
          {c.themes.map((t) => <span key={t} className="rounded border border-line bg-ink/5 px-2 py-0.5">{t.replace(/_/g, " ")}</span>)}
        </div>
      )}

      {c.outcome.holding && (
        <section className="mt-4">
          <h2 className="font-serif text-lg">Holding</h2>
          <p className="text-sm text-ink2">{c.outcome.holding}</p>
          {c.outcome.whoWon && <p className="text-xs text-ink3">Who won: {c.outcome.whoWon}</p>}
        </section>
      )}

      {c.economic && (
        <section className="mt-4">
          <h2 className="font-serif text-lg">Economic dimension</h2>
          <p className="text-sm text-ink2">{c.economic.economicSummary}</p>
          {c.economic.settlementAmount != null && <p className="text-sm text-ink2">Settlement: ${c.economic.settlementAmount.toLocaleString()} CAD</p>}
        </section>
      )}

      {c.valueRealization && (
        <section className="mt-4">
          <h2 className="font-serif text-lg">Value realization</h2>
          <p className="text-sm text-ink2"><span className="rounded bg-cedar/15 px-2 py-0.5 text-cedar">{c.valueRealization.status}</span> {c.valueRealization.note}</p>
        </section>
      )}

      {c.summary && (
        <section className="mt-4">
          <h2 className="font-serif text-lg">
            Summary <span className="text-xs font-sans font-normal text-ink3">(citation-anchored)</span>
            {" "}
            {c.summaryMeta?.method === "llm" && (
              <span className="ml-2 rounded bg-amber/15 px-2 py-0.5 text-xs font-sans font-normal text-amber">AI-generated · plain language</span>
            )}
          </h2>
          <ul className="mt-1 space-y-1 text-sm text-ink2">
            {c.summary.claims.map((cl, i) => (
              <li key={i}>{cl.text} <a href={cl.sourceUrl} className="text-xs text-amber hover:underline" target="_blank" rel="noreferrer">[{cl.sourceParagraph}]</a></li>
            ))}
          </ul>
          {c.summaryMeta?.method === "llm" && (
            <p className="mt-1 text-xs text-ink3">AI paraphrase — unofficial; verify each claim against its anchored paragraph.</p>
          )}
        </section>
      )}

      {!c.outcome.holding && !c.fullTextAvailable && (
        <p className="mt-4 rounded border border-line bg-ink/5 px-3 py-2 text-sm text-ink3">
          Not yet curated, and no full text is available for this record. See the official source below.
        </p>
      )}

      {c.chunks && c.chunks.length > 0 && <FullTextReader chunks={c.chunks} q={q} />}

      <section className="mt-4">
        <h2 className="font-serif text-lg">Citations</h2>
        <p className="text-sm text-ink2">Cited by {c.citingCount} case(s).</p>
        <div className="mt-1 grid grid-cols-2 gap-3 text-sm">
          <div><div className="text-xs text-ink3">Cites</div>{graph.cited.map((g) => <Link key={g.id} href={`/cases/${g.id}`} className="block hover:text-amber hover:underline">{g.styleOfCause}</Link>)}</div>
          <div><div className="text-xs text-ink3">Cited by</div>{graph.citing.map((g) => <Link key={g.id} href={`/cases/${g.id}`} className="block hover:text-amber hover:underline">{g.styleOfCause}</Link>)}</div>
        </div>
      </section>

      <ProvenanceFooter c={c} />
    </div>
  );
}
