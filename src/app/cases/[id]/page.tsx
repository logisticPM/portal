import Link from "next/link";
import { notFound } from "next/navigation";
import { casesRepo } from "@/lib/cases";

export default async function CaseDetail({ params }: { params: { id: string } }) {
  const c = await casesRepo.getCase(params.id);
  if (!c) notFound();
  const graph = await casesRepo.getCitationGraph(c.id);

  return (
    <main className="mx-auto max-w-3xl p-6">
      <Link href="/cases" className="text-sm text-gray-500 hover:underline">← all cases</Link>
      <h1 className="mt-2 text-2xl font-semibold">{c.styleOfCause}</h1>
      <div className="text-sm text-gray-500">{c.citation}{c.citation2 ? ` · ${c.citation2}` : ""} · {c.court} · {c.year}</div>
      <div className="mt-1 flex flex-wrap gap-1 text-xs">
        {c.themes.map((t) => <span key={t} className="rounded bg-gray-100 px-2 py-0.5">{t.replace(/_/g, " ")}</span>)}
        <span className="rounded bg-blue-100 px-2 py-0.5 text-blue-700">{c.outcome.winType.replace(/_/g, " ")}</span>
      </div>

      <section className="mt-4">
        <h2 className="font-semibold">Holding</h2>
        <p className="text-sm">{c.outcome.holding}</p>
        <p className="text-xs text-gray-500">Who won: {c.outcome.whoWon}</p>
      </section>

      {c.economic && (
        <section className="mt-4">
          <h2 className="font-semibold">Economic dimension</h2>
          <p className="text-sm">{c.economic.economicSummary}</p>
          {c.economic.settlementAmount != null && <p className="text-sm">Settlement: ${c.economic.settlementAmount.toLocaleString()} CAD</p>}
        </section>
      )}

      {c.valueRealization && (
        <section className="mt-4">
          <h2 className="font-semibold">Value realization</h2>
          <p className="text-sm"><span className="rounded bg-green-100 px-2 py-0.5 text-green-700">{c.valueRealization.status}</span> {c.valueRealization.note}</p>
        </section>
      )}

      {c.summary && (
        <section className="mt-4">
          <h2 className="font-semibold">Summary <span className="text-xs font-normal text-gray-500">(citation-anchored)</span></h2>
          <ul className="mt-1 space-y-1 text-sm">
            {c.summary.claims.map((cl, i) => (
              <li key={i}>{cl.text} <a href={cl.sourceUrl} className="text-xs text-blue-600 hover:underline" target="_blank" rel="noreferrer">[{cl.sourceParagraph}]</a></li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-4">
        <h2 className="font-semibold">Citations</h2>
        <p className="text-sm">Cited by {c.citingCount} case(s).</p>
        <div className="mt-1 grid grid-cols-2 gap-3 text-sm">
          <div><div className="text-xs text-gray-500">Cites</div>{graph.cited.map((g) => <Link key={g.id} href={`/cases/${g.id}`} className="block hover:underline">{g.styleOfCause}</Link>)}</div>
          <div><div className="text-xs text-gray-500">Cited by</div>{graph.citing.map((g) => <Link key={g.id} href={`/cases/${g.id}`} className="block hover:underline">{g.styleOfCause}</Link>)}</div>
        </div>
      </section>

      <footer className="mt-6 border-t pt-3 text-xs text-gray-500">
        {c.provenance.unofficial && "Unofficial reproduction. "}
        Source: <a href={c.provenance.sourceUrl} className="text-blue-600 hover:underline" target="_blank" rel="noreferrer">official decision</a>. License: {c.provenance.upstreamLicense}
      </footer>
    </main>
  );
}
