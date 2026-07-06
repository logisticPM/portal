import { casesRepo } from "@/lib/cases";
import { StatCard, Bar } from "../ui";

export default async function MethodologyPage() {
  const st = await casesRepo.getCorpusStats();
  const levels = Object.entries(st.byLevel);
  const maxLevel = Math.max(1, ...levels.map(([, n]) => n));
  const decades = Object.entries(st.byDecade);
  const maxDecade = Math.max(1, ...decades.map(([, n]) => n));

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-serif text-2xl">Methodology</h1>
      <p className="mt-1 text-sm text-ink3">How this corpus is built, labeled, and evaluated — transparent by design.</p>

      <div className="mt-4 grid grid-cols-4 gap-3">
        <StatCard label="total cases" value={st.total} />
        <StatCard label="curated core" value={st.core} />
        <StatCard label="substrate" value={st.substrate} />
        <StatCard label="full text" value={st.fullText} />
      </div>

      <section className="mt-6">
        <h2 className="font-serif text-lg">By court level</h2>
        <div className="mt-2 space-y-1">{levels.map(([l, n]) => <Bar key={l} label={l.replace(/_/g, " ")} n={n} max={maxLevel} />)}</div>
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
          <h2 className="font-serif text-lg">Briefing notes</h2>
          <p>Briefing notes are generated on demand: a question retrieves the most relevant curated cases (the same ranked search used across the site), and the model may cite <strong>only those retrieved cases</strong> — any invented case reference is mechanically discarded, and a briefing with fewer than two verifiable precedents is refused rather than published. Notes describe what precedents establish, not what a reader should do; they are AI-generated, badged, rate-limited, and <strong>not legal advice</strong>.</p>
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
