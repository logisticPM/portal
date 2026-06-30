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
  const cases = q ? await casesRepo.hybridSearch(q, filter) : await casesRepo.listCases(filter);
  const facets = await casesRepo.listFacets();

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="text-2xl font-semibold">Legal Cases — Economic Justice</h1>
      <p className="mt-1 text-sm text-gray-500">
        Indigenous economic-justice case law. Every claim links to its source.
      </p>

      <form className="mt-4 flex gap-2" action="/cases">
        <input
          name="q" defaultValue={q} placeholder="Search citation, case name, nation…"
          className="flex-1 rounded border px-3 py-2"
        />
        <button className="rounded bg-black px-4 py-2 text-white">Search</button>
      </form>

      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        {THEMES.map((t) => (
          <Link key={t} href={`/cases?theme=${t}`} className="rounded-full border px-3 py-1 hover:bg-gray-50">
            {t.replace(/_/g, " ")} <span className="text-gray-400">{facets.byTheme[t] ?? 0}</span>
          </Link>
        ))}
        <Link href="/cases" className="rounded-full border px-3 py-1 hover:bg-gray-50">clear</Link>
      </div>

      <ul className="mt-6 divide-y">
        {cases.map((c) => (
          <li key={c.id} className="py-3">
            <Link href={`/cases/${c.id}`} className="font-medium hover:underline">{c.styleOfCause}</Link>
            <div className="text-sm text-gray-500">
              {c.citation} · {c.court} · {c.year}
              {!c.fullTextAvailable && <span className="ml-2 rounded bg-amber-100 px-1 text-amber-700">index only</span>}
            </div>
            <div className="text-sm">{c.outcome.holding}</div>
          </li>
        ))}
        {cases.length === 0 && <li className="py-3 text-gray-500">No cases match.</li>}
      </ul>
    </main>
  );
}
