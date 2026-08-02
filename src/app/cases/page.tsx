import Link from "next/link";
import { casesRepo } from "@/lib/cases";
import type { Theme, CourtLevel, WinType, CorpusTier, RealizationStatus, FigureKind } from "@/lib/cases";
import { CaseListItem, LensSwitcher, Pagination } from "./ui";
import { getSession } from "@/lib/auth";
import { resolveLens, applyLens } from "@/lib/cases/lenses";
import { PAGE_SIZE, clampPage } from "@/lib/cases/pagination";
import { COURT_LEVELS, courtLevelLabel, THEMES, themeLabel } from "@/lib/cases/labels";
import { describeDrillIns } from "@/lib/cases/drill-in";

const WINTYPES: WinType[] = ["doctrine_win", "party_win", "mixed", "loss", "unclassified"];

export default async function CasesPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const q = searchParams.q ?? "";
  const tier: CorpusTier | "all" = (searchParams.tier as CorpusTier | "all") || (q ? "all" : "core");
  const fullTextParam: "yes" | "no" | undefined =
    searchParams.fullText === "yes" ? "yes" : searchParams.fullText === "no" ? "no" : undefined;
  const filter = {
    themes: searchParams.theme ? [searchParams.theme as Theme] : undefined,
    level: (searchParams.level as CourtLevel) || undefined,
    winType: (searchParams.winType as WinType) || undefined,
    nation: searchParams.nation || undefined,
    yearFrom: searchParams.yearFrom ? Number(searchParams.yearFrom) : undefined,
    yearTo: searchParams.yearTo ? Number(searchParams.yearTo) : undefined,
    tier,
    // Arrive here from an activation-dashboard number or a coverage row. These have no
    // <select> of their own — they are landing states, and the active-filter strip below
    // is what makes them visible and dismissible.
    realization: (searchParams.realization as RealizationStatus) || undefined,
    figureKind: (searchParams.figureKind as FigureKind) || undefined,
    fullText: fullTextParam,
  };
  const cases = q ? await casesRepo.hybridSearch(q, filter) : await casesRepo.listCases(filter);
  const facets = await casesRepo.listFacets({ tier: "all" });
  const nations = Object.keys(facets.byNation).sort();

  const session = getSession();
  const lens = resolveLens(searchParams.lens, session);
  // Lens reorders the BROWSE list only. When there's a search query, retrieval
  // ranking (dense/BM25) is authoritative — the lens contributes framing, not order.
  const ordered = q ? cases : applyLens(cases, lens);
  const total = ordered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = clampPage(searchParams.page, totalPages);
  const start = (page - 1) * PAGE_SIZE;
  const pageItems = ordered.slice(start, start + PAGE_SIZE);

  const drillIns = describeDrillIns(searchParams);
  const sel = "rounded border border-line bg-panel px-2 py-1";
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="font-serif text-2xl">Legal cases — economic justice</h1>
      <p className="mt-1 text-sm text-ink3">Canada&apos;s Indigenous economic-justice case law, searchable and citation-anchored.</p>
      <p className="mt-1 text-sm"><Link href="/cases/similar" className="text-amber hover:underline">Describe your situation to find similar cases →</Link></p>

      <LensSwitcher active={lens} params={searchParams} searching={!!q} />

      <form action="/cases" className="mt-4 space-y-2">
        <input type="hidden" name="lens" value={lens} />
        {/* The drill-in filters have no control of their own, so without these the first
            Search after arriving from the dashboard would silently widen the result set
            back out — the reader would think their click had been undone. */}
        {filter.realization && <input type="hidden" name="realization" value={filter.realization} />}
        {filter.figureKind && <input type="hidden" name="figureKind" value={filter.figureKind} />}
        {filter.fullText && <input type="hidden" name="fullText" value={filter.fullText} />}
        <div className="flex gap-2">
          <input name="q" defaultValue={q} placeholder="Search citation, case name, or full text…" className="flex-1 rounded border border-line bg-panel px-3 py-2" />
          <button className="rounded bg-ink px-4 py-2 text-bg hover:bg-ink/90">Search</button>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <select name="tier" defaultValue={searchParams.tier ?? ""} className={sel} aria-label="Tier">
            <option value="">Tier: auto</option><option value="core">Core only</option><option value="all">All tiers</option>
          </select>
          <select name="theme" defaultValue={searchParams.theme ?? ""} className={sel} aria-label="Theme">
            <option value="">All themes</option>{THEMES.map((t) => <option key={t} value={t}>{themeLabel(t)}</option>)}
          </select>
          <select name="level" defaultValue={searchParams.level ?? ""} className={sel} aria-label="Court level">
            <option value="">All courts</option>{COURT_LEVELS.map((l) => <option key={l} value={l}>{courtLevelLabel(l)}</option>)}
          </select>
          <select name="winType" defaultValue={searchParams.winType ?? ""} className={sel} aria-label="Outcome">
            <option value="">All outcomes</option>{WINTYPES.map((w) => <option key={w} value={w}>{w.replace(/_/g, " ")}</option>)}
          </select>
          <select name="nation" defaultValue={searchParams.nation ?? ""} className={sel} aria-label="Nation">
            <option value="">All nations</option>{nations.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <input name="yearFrom" defaultValue={searchParams.yearFrom ?? ""} placeholder="from yr" className={`w-20 ${sel}`} aria-label="Year from" />
          <input name="yearTo" defaultValue={searchParams.yearTo ?? ""} placeholder="to yr" className={`w-20 ${sel}`} aria-label="Year to" />
          <Link href="/cases" className="rounded-full border border-line px-3 py-1 hover:bg-ink/5">clear</Link>
        </div>
      </form>

      {drillIns.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-ink3">Filtered from the dashboard:</span>
          {drillIns.map((d) => (
            <Link key={d.key} href={d.without} aria-label={`Remove filter ${d.label}`}
              className="rounded-full border border-amber/40 bg-amber/10 px-2 py-0.5 text-amber hover:bg-amber/20">
              {d.label} ×
            </Link>
          ))}
        </div>
      )}

      <div className="mt-3 text-xs text-ink3">
        {total} result{total === 1 ? "" : "s"} · {total > 0 ? `showing ${start + 1}–${Math.min(start + PAGE_SIZE, total)} · ` : ""}{q ? "ranked by relevance" : "browse"} · tier: {tier}
      </div>

      <ul className="mt-3 divide-y divide-line">
        {pageItems.map((c) => <CaseListItem key={c.id} c={c} q={q} />)}
        {total === 0 && (
          <li className="py-3 text-ink3">
            {q
              ? "No cases match."
              : "No cases in this view yet — the corpus may not be loaded in this environment. See Methodology for corpus status."}
          </li>
        )}
      </ul>

      <Pagination page={page} totalPages={totalPages} params={searchParams} />
    </div>
  );
}
