import Link from "next/link";
import { casesRepo } from "@/lib/cases";
import { StatCard, Bar } from "../ui";
import { getSession } from "@/lib/auth";
import { resolveLens, lensConfig } from "@/lib/cases/lenses";
import { themeLabel } from "@/lib/cases/labels";
import { SCREENING, screenedOut } from "@/lib/cases/screening";

const cad = (n: number) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(n);

export default async function ActivationPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const s = await casesRepo.getActivationSummary();
  const themes = Object.entries(s.byTheme);
  const maxTheme = Math.max(1, ...themes.map(([, n]) => n));
  const real = s.valueRealization;
  const ef = s.economicFigures;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-serif text-2xl">Activation dashboard</h1>
      <p className="mt-1 text-sm text-ink3">Turning Indigenous legal wins into economic intelligence (curated core cases).</p>
      <p className="mt-1 text-sm text-ink3">{lensConfig(resolveLens(searchParams.lens, getSession())).tagline}</p>

      <p className="mt-3 text-xs text-ink3">Every number below opens the cases behind it.</p>

      {/* The client asked whether the activation data is incomplete. The figures were already
          honest about their SCOPE — the subtitle says "curated core cases" — but silent about why
          the corpus is only that size, and on a dashboard silence reads as "incomplete, and they
          have not noticed". Placed above the numbers, not in a footnote: a reader should know the
          denominator before reading anything computed on it.
          screenedOut() and SCREENING.excluded.no_model_consensus, NEVER a fresh sum over
          SCREENING.excluded. Those 343 records ARE on topic — they cleared the relevance screen
          and are held back only because two labellers disagreed on which theme. A reduce() over
          `excluded` counts them as rejected, which turns "we held 343 back out of caution" into
          "we discarded 4,889", and that is the one number on this page it would be worst to get
          wrong. screening.ts already encodes the distinction; this reuses it rather than
          re-deriving it. */}
      <p className="mt-2 rounded border border-line bg-panel px-3 py-2 text-xs text-ink3">
        <strong className="text-ink2">Why this corpus and not more.</strong>{" "}
        Of {SCREENING.substrate.toLocaleString()} records screened (as of {SCREENING.asOf}),{" "}
        {screenedOut().toLocaleString()} were set aside as off topic — no Indigenous-party signal,
        or no economic-justice theme. A further{" "}
        {(SCREENING.excluded.no_model_consensus ?? 0).toLocaleString()} <em>are</em> on topic but
        are held back because two independent labellers could not agree on the theme, so they go
        uncounted here rather than labelled on one model&apos;s word.{" "}
        <Link href="/cases/methodology#coverage" className="text-amber hover:underline">
          See the screening funnel and jurisdiction coverage →
        </Link>
      </p>

      <div className="mt-2 grid grid-cols-3 gap-3">
        <Link href="/cases?tier=core" className="block hover:opacity-80"><StatCard label="curated cases" value={s.totalCases} /></Link>
        <Link href="/cases?tier=core&realization=realized" className="block hover:opacity-80"><StatCard label="value realized" value={real.realized ?? 0} /></Link>
        <Link href="/cases?tier=core&realization=negotiating" className="block hover:opacity-80"><StatCard label="negotiating" value={real.negotiating ?? 0} /></Link>
      </div>

      <section className="mt-6">
        <h2 className="font-serif text-lg">Recorded economic figures <span className="text-xs font-sans font-normal text-ink3">(as recorded in the judgments)</span></h2>
        <p className="mt-1 text-sm text-ink3">Figures recorded in {ef.casesWithFigures} of {ef.totalCases} core cases.</p>
        <div className="mt-2 space-y-1 text-sm">
          {Object.entries(ef.byKind).map(([kind, r]) => (
            <Link key={kind} href={`/cases?tier=core&figureKind=${kind}`}
              className="flex justify-between rounded border border-line bg-panel px-3 py-2 hover:border-amber/50">
              <span className="capitalize">{kind.replace(/_/g, " ")} <span className="text-ink3">· {r.countCases} case{r.countCases === 1 ? "" : "s"}</span></span>
              <span className="text-ink2">
                {r.unit === "%" ? `${r.min}–${r.max}% (median ${r.median}%)` : `${cad(r.min)}–${cad(r.max)} (median ${cad(r.median)})`}
              </span>
            </Link>
          ))}
          {Object.keys(ef.byKind).length === 0 && <p className="text-ink3">No court-awarded figures recorded yet.</p>}
        </div>
        <p className="mt-2 text-xs text-ink3">The courts&rsquo; own numbers, extracted and citation-anchored — not estimates, projections, or a corpus total; nominal amounts across different years, not inflation-adjusted.</p>
      </section>

      <section className="mt-6">
        <h2 className="font-serif text-lg">By theme</h2>
        <div className="mt-2 space-y-1">
          {themes.map(([t, n]) => (
            <Link key={t} href={`/cases?tier=core&theme=${t}`} className="block hover:opacity-80">
              <Bar label={themeLabel(t)} n={n} max={maxTheme} />
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="font-serif text-lg">Value-realization funnel</h2>
        <div className="mt-2 flex gap-3 text-sm">
          {(["declared", "negotiating", "realized", "stalled"] as const).map((k) => (
            <Link key={k} href={`/cases?tier=core&realization=${k}`}
              className="rounded border border-line bg-panel px-3 py-2 hover:border-amber/50">
              <div className="font-serif text-lg">{real[k] ?? 0}</div><div className="text-xs text-ink3">{k}</div>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="font-serif text-lg">Landmark cases <span className="text-xs font-sans font-normal text-ink3">(by citation authority)</span></h2>
        <ul className="mt-1 text-sm">
          {s.landmarkCases.map((c) => (
            <li key={c.id}><Link href={`/cases/${c.id}`} className="hover:text-amber hover:underline">{c.styleOfCause}</Link> <span className="text-ink3">cited {c.citingCount}×</span></li>
          ))}
        </ul>
      </section>
    </div>
  );
}
