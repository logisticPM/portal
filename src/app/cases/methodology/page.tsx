import Link from "next/link";
import { casesRepo } from "@/lib/cases";
import { StatCard, Bar } from "../ui";
import { courtLevelLabel } from "@/lib/cases/labels";
import { SCREENING, screenedOut } from "@/lib/cases/screening";

export default async function MethodologyPage() {
  const st = await casesRepo.getCorpusStats();
  const cov = st.coverage;
  const levels = Object.entries(st.byLevel);
  const maxLevel = Math.max(1, ...levels.map(([, n]) => n));
  const decades = Object.entries(st.byDecade);
  const maxDecade = Math.max(1, ...decades.map(([, n]) => n));

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-serif text-2xl">Methodology</h1>
      <p className="mt-1 text-sm text-ink3">How this corpus is built, labeled, and evaluated — transparent by design.</p>

      <div className="mt-4 grid grid-cols-4 gap-3">
        <Link href="/cases?tier=all" className="block hover:opacity-80"><StatCard label="records harvested" value={st.total} /></Link>
        <Link href="/cases?tier=core" className="block hover:opacity-80"><StatCard label="curated core" value={st.core} /></Link>
        <Link href="/cases?tier=substrate" className="block hover:opacity-80"><StatCard label="substrate" value={st.substrate} /></Link>
        <Link href="/cases?tier=all&fullText=yes" className="block hover:opacity-80"><StatCard label="full text" value={st.fullText} /></Link>
      </div>
      <p className="mt-2 text-xs text-ink3">
        “Records harvested” is the whole intake, not a count of Indigenous economic-justice
        cases. The substrate is a deliberately wide retrieval haystack and most of it is
        general litigation that the relevance screen excluded — see the screening funnel
        below for what survived. Every number here opens the records behind it.
      </p>

      <section className="mt-6">
        <h2 className="font-serif text-lg">Screening funnel <span className="text-xs font-sans font-normal text-ink3">(as of {SCREENING.asOf})</span></h2>
        <p className="mt-1 text-sm text-ink3">
          What the relevance screen did to the {SCREENING.substrate.toLocaleString()} substrate
          records. A record reaches core only if it shows both an Indigenous-party signal and
          an economic-justice theme, <em>and</em> two different model families agree on a theme.
        </p>
        <div className="mt-2 space-y-1 text-sm">
          <div className="flex justify-between rounded border border-line bg-panel px-3 py-2">
            <span>Screened out — no Indigenous signal, or no economic theme</span>
            <span className="tabular-nums text-ink3">{screenedOut().toLocaleString()}</span>
          </div>
          <div className="flex justify-between rounded border border-amber/30 bg-amber/5 px-3 py-2">
            <span>On topic, but the two labellers disagreed on a theme</span>
            <span className="tabular-nums text-ink2">{(SCREENING.excluded.no_model_consensus ?? 0).toLocaleString()}</span>
          </div>
          <div className="flex justify-between rounded border border-line bg-panel px-3 py-2">
            <span>Promoted to core by this run</span>
            <span className="tabular-nums text-ink2">{SCREENING.promoted.toLocaleString()}</span>
          </div>
        </div>
        <p className="mt-2 text-xs text-ink3">
          So the on-topic population the screen can currently identify is about{" "}
          <strong>{(st.core + (SCREENING.excluded.no_model_consensus ?? 0)).toLocaleString()}</strong>{" "}
          records — {st.core.toLocaleString()} curated into core plus{" "}
          {(SCREENING.excluded.no_model_consensus ?? 0).toLocaleString()} held back for want of
          label agreement. Those held-back cases are on topic; they are excluded rather than
          labelled on one model&rsquo;s word, which keeps core clean at the cost of coverage.
        </p>
      </section>

      {/* Anchored because this section is what the client meant by "how is completeness
          displayed" — which courts are in, which are absent, what lacks full text. It was
          already built and correct, but only reachable by scrolling Methodology, so nobody
          looking for completeness would find it. /cases now links straight here. The nav is
          not sticky, so no scroll-margin is needed. */}
      <section id="coverage" className="mt-6">
        <h2 className="font-serif text-lg">Coverage by jurisdiction</h2>
        <p className="mt-1 text-sm text-ink3">
          Derived from the court of decision. Every Canadian jurisdiction is listed,
          including the ones we hold nothing from — a count can show what is present, so
          the absences have to be stated explicitly.
        </p>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-ink3">
              <tr className="border-b border-line text-left">
                <th className="py-1 pr-3 font-normal">Jurisdiction</th>
                <th className="py-1 pr-3 text-right font-normal">Records</th>
                <th className="py-1 pr-3 text-right font-normal">Core</th>
                <th className="py-1 pr-3 text-right font-normal">Full text</th>
                <th className="py-1 font-normal">Courts held</th>
              </tr>
            </thead>
            <tbody>
              {cov.rows.map((r) => (
                <tr key={r.jurisdiction} className={`border-b border-line/50 ${r.total === 0 ? "text-ink3" : ""}`}>
                  <td className="py-1 pr-3">{r.jurisdiction}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{r.total || "—"}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{r.core || "—"}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{r.fullText || "—"}</td>
                  <td className="py-1 text-xs">{r.total === 0 ? <span className="text-amber/80">no coverage</span> : r.courts.join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-ink3">
          {cov.covered} of {cov.rows.length} jurisdictions represented.
          {" "}The corpus is frame-bounded: its upstream index does not scrape CanLII and is
          federal-court-skewed, so absence here means <strong>absent from this corpus</strong>,
          never absent from Canadian law.
          {Object.keys(cov.unmapped).length > 0 && (
            <> {Object.values(cov.unmapped).reduce((a, b) => a + b, 0)} record(s) sit in courts this
            table does not yet map ({Object.keys(cov.unmapped).join(", ")}) and are excluded from every row above.</>
          )}
        </p>
      </section>

      <section className="mt-6">
        <h2 className="font-serif text-lg">By court level</h2>
        <div className="mt-2 space-y-1">{levels.map(([l, n]) => <Bar key={l} label={courtLevelLabel(l)} n={n} max={maxLevel} />)}</div>
      </section>

      <section className="mt-6">
        <h2 className="font-serif text-lg">By decade</h2>
        <div className="mt-2 space-y-1">{decades.map(([d, n]) => <Bar key={d} label={d} n={n} max={maxDecade} />)}</div>
      </section>

      <section className="mt-6 space-y-4 text-sm text-ink2">
        <div>
          <h2 className="font-serif text-lg">Two-tier corpus</h2>
          <p>A broad <strong>substrate</strong> (full-text judgments, the retrieval haystack) plus a curated <strong>core</strong> (labeled themes, outcome classification, economic dimension, citation-anchored summary). Substrate records are shown as “index only” or “full text”; only core carries curated fields.</p>
        </div>
        <div>
          <h2 className="font-serif text-lg">Sources &amp; provenance</h2>
          <p>Cases are harvested from the open A2AJ API (metadata + citation graph) and matched to official court decisions for full text. All displayed judgment text is an <strong>unofficial reproduction</strong> of a public decision, linked to its official source; judgment text is never generated. AI-generated content (plain-language summaries) is always labeled as such and citation-anchored.</p>
          <p className="mt-2">
            Each plain-language point is anchored to a paragraph by locating its quotation in
            the judgment. Most match the text verbatim; a small share match exactly one
            paragraph to within a few characters and are anchored to it, which recovers
            points that a strict verbatim test would discard. A quotation matching two
            paragraphs equally well is <strong>not</strong> anchored — an ambiguous citation
            is worse than a missing one. The model&rsquo;s quotation is never published; it
            is used only to find the paragraph.
          </p>
        </div>
        <div>
          <h2 className="font-serif text-lg">Selection (PRISMA-style)</h2>
          <p>Inclusion is an explicit, logged filter (Indigenous + economic-justice signal), so the corpus boundary is auditable rather than editorial.</p>
        </div>
        <div>
          <h2 className="font-serif text-lg">Labeling</h2>
          <p>Themes and outcome tags on core cases are assigned by dual-model cross-labeling — inter-model agreement measures <em>consistency</em>; accuracy is validated against a human-checked gold sample. Cross-model agreement also gates curation: cases where the two models agree on <strong>no theme at all</strong> are not promoted to core — they stay in the substrate pending human review. Labels are <strong>metadata only</strong>; displayed judgment text stays extractive, and plain-language summaries are the one generated layer, always badged (see below).</p>
        </div>
        <div>
          <h2 className="font-serif text-lg">AI plain-language summaries</h2>
          <p>Core cases with full text carry an AI-generated plain-language summary, badged as such. Every claim is anchored to a verbatim quote that is <strong>mechanically verified</strong> against the judgment text before display — claims whose quotes cannot be found verbatim are discarded, and a case with fewer than two verified claims gets no summary at all. Verification guarantees the quotes are real; paraphrase fidelity is validated by human spot-check. Flagship summaries are human-curated and never overwritten.</p>
        </div>
        <div>
          <h2 className="font-serif text-lg">Legal information assistant</h2>
          <p>The legal-information assistant answers questions on demand: a question retrieves the most relevant curated cases (the same ranked search used across the site), and the model may cite <strong>only those retrieved cases</strong> — any invented case reference is mechanically discarded, and an answer with fewer than two verifiable precedents is refused rather than published. It describes what precedents establish, not what a reader should do. When a question reads as asking about a specific situation, a mechanical guard surfaces a reminder to consult qualified counsel or an Indigenous legal clinic. Answers are AI-generated, badged, rate-limited, and provide <strong>legal information, not legal advice</strong>.</p>
        </div>
        <div>
          <h2 className="font-serif text-lg">Find similar cases</h2>
          <p>The similar-cases tool ranks curated cases against a described situation by a <strong>deterministic, explainable</strong> blend of semantic closeness (a case-level embedding), theme overlap, and jurisdiction — never a trained predictor. Each result shows a match-strength label and <em>why</em> it matched; when nothing is strongly comparable it says so. It is a <strong>research starting point, not a legal match or prediction</strong>, and not legal advice.</p>
        </div>
        <div>
          <h2 className="font-serif text-lg">Citation treatment</h2>
          <p>On a case page, "later cases citing this decision" shows the <strong>verbatim passage</strong> where each in-corpus later case cites it, with its paragraph anchor — so a reader can see <em>how</em> the case was used. It is deliberately <strong>extractive only</strong>: no "followed / distinguished / overruled" classification (a legal conclusion we don't assert), and it is bounded to cases in this library.</p>
        </div>
        <div>
          <h2 className="font-serif text-lg">Ask this judgment</h2>
          <p>On a case page you can ask a question about that single decision. The answer is generated the same way as our summaries — <strong>extractive and paragraph-anchored</strong>: every point must quote a real paragraph of that judgment or it is dropped, and if the decision does not address the question the assistant <strong>says so</strong> rather than guessing. Single-source, badged, rate-limited, and <strong>not legal advice</strong>.</p>
        </div>
        <div>
          <h2 className="font-serif text-lg">Retrieval evaluation</h2>
          <p>Search quality is measured (nDCG@10 / recall@10 / MRR) on a graded gold set, comparing lexical (BM25) against hybrid retrieval, so ranking changes are evidence-based, not asserted.</p>
        </div>
        <div>
          <h2 className="font-serif text-lg">Data sovereignty</h2>
          <p>Built to respect OCAP® and CARE principles: public court records only, clearly framed, with community-sensitive material kept out of third-party pipelines.</p>
        </div>
      </section>
    </div>
  );
}
