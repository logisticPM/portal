// Server component. Reads casesRepo directly. Search + theme/level filters come
// in via searchParams (no client state needed for MVP). Reuses ui.tsx primitives.
import Link from "next/link";
import { casesRepo } from "@/lib/cases";
import type { Theme, CourtLevel } from "@/lib/cases";

const THEMES: Theme[] = ["land_rights", "resource_revenue", "duty_to_consult", "treaty", "fiduciary", "self_determination"];

export default async function CasesPage({
  searchParams,
}: {
  searchParams: { q?: string; theme?: Theme; level?: CourtLevel };
}) {
  const q = searchParams.q ?? "";
  const filter = {
    themes: searchParams.theme ? [searchParams.theme] : undefined,
    level: searchParams.level,
  };
  const cases = q ? await casesRepo.searchCases(q, filter) : await casesRepo.listCases(filter);
  const facets = await casesRepo.listFacets();

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="font-serif text-2xl">Legal Cases — Economic Justice</h1>
      <p className="mt-1 text-sm text-ink3">
        Indigenous economic-justice case law. Every claim links to its source.
      </p>

      <form className="mt-4 flex gap-2" action="/cases">
        <input
          name="q" defaultValue={q} placeholder="Search citation, case name, nation…"
          className="flex-1 rounded border border-line bg-panel px-3 py-2"
        />
        <button className="rounded bg-ink px-4 py-2 text-bg hover:bg-ink/90">Search</button>
      </form>

      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        {THEMES.map((t) => (
          <Link key={t} href={`/cases?theme=${t}`} className="rounded-full border border-line px-3 py-1 hover:bg-ink/5">
            {t.replace(/_/g, " ")} <span className="text-ink3">{facets.byTheme[t] ?? 0}</span>
          </Link>
        ))}
        <Link href="/cases" className="rounded-full border border-line px-3 py-1 hover:bg-ink/5">clear</Link>
      </div>

      <ul className="mt-6 divide-y divide-line">
        {cases.map((c) => (
          <li key={c.id} className="py-3">
            <Link href={`/cases/${c.id}`} className="font-medium hover:text-amber hover:underline">{c.styleOfCause}</Link>
            <div className="text-sm text-ink3">
              {c.citation} · {c.court} · {c.year}
              {!c.fullTextAvailable && <span className="ml-2 rounded bg-amber/10 px-1 text-amber">index only</span>}
            </div>
            <div className="text-sm text-ink2">{c.outcome.holding}</div>
          </li>
        ))}
        {cases.length === 0 && <li className="py-3 text-ink3">No cases match.</li>}
      </ul>
    </div>
  );
}
