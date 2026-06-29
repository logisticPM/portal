// PURE query logic over LegalCase[] — shared by repo.mock and repo.dynamo so the
// two impls are identical by construction (the verify.ts golden test).
import { caseFixtures } from "./fixtures";
import type {
  LegalCase, CaseFilter, Facets, ActivationSummary, CitationGraph,
  Theme, CourtLevel, WinType, RealizationStatus,
} from "./types";

export { caseFixtures }; // convenience re-export for tests

export function filterCases(cases: LegalCase[], f?: CaseFilter): LegalCase[] {
  return cases.filter((c) =>
    (f?.tier ? c.corpusTier === f.tier : c.corpusTier === "core") &&  // default: core-only
    (!f?.themes?.length || f.themes.some((t) => c.themes.includes(t))) &&
    (!f?.level || c.level === f.level) &&
    (!f?.winType || c.outcome.winType === f.winType) &&
    (!f?.nation || c.nations.includes(f.nation)) &&
    (f?.yearFrom === undefined || c.year >= f.yearFrom) &&
    (f?.yearTo === undefined || c.year <= f.yearTo));
}

// Hybrid-spirit scoring: exact tokens (citation, name, nation) weighted highest —
// the property real legal search depends on (see spec §10).
function score(c: LegalCase, q: string): number {
  let s = 0;
  if (c.citation.toLowerCase().includes(q)) s += 10;
  if (c.citation2?.toLowerCase().includes(q)) s += 10;
  if (c.styleOfCause.toLowerCase().includes(q)) s += 8;
  if (c.nations.some((n) => n.toLowerCase().includes(q))) s += 5;
  if (c.outcome.holding.toLowerCase().includes(q)) s += 3;
  if (c.chunks?.some((ch) => ch.text.toLowerCase().includes(q))) s += 2;
  return s;
}

export function searchCases(cases: LegalCase[], query: string, f?: CaseFilter): LegalCase[] {
  const base = filterCases(cases, f);
  const q = query.toLowerCase().trim();
  if (!q) return [...base].sort((a, b) => b.year - a.year);
  return base
    .map((c) => ({ c, s: score(c, q) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || b.c.citingCount - a.c.citingCount || a.c.id.localeCompare(b.c.id))
    .map((x) => x.c);
}

// Sort object keys for deterministic JSON.stringify across mock and dynamo
// (scan order is not guaranteed; key insertion order would vary otherwise).
function sortKeys<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b))) as T;
}

export function buildFacets(cases: LegalCase[]): Facets {
  const f: Facets = { byTheme: {}, byLevel: {}, byWinType: {}, byNation: {} };
  for (const c of cases) {
    for (const t of c.themes) f.byTheme[t] = (f.byTheme[t] ?? 0) + 1;
    f.byLevel[c.level] = (f.byLevel[c.level] ?? 0) + 1;
    f.byWinType[c.outcome.winType] = (f.byWinType[c.outcome.winType] ?? 0) + 1;
    for (const n of c.nations) f.byNation[n] = (f.byNation[n] ?? 0) + 1;
  }
  return {
    byTheme: sortKeys(f.byTheme),
    byLevel: sortKeys(f.byLevel),
    byWinType: sortKeys(f.byWinType),
    byNation: sortKeys(f.byNation),
  };
}

export function buildActivation(cases: LegalCase[]): ActivationSummary {
  const byTheme: Partial<Record<Theme, number>> = {};
  const valueRealization: Partial<Record<RealizationStatus, number>> = {};
  const economicValue = { settlement: 0, resourceRevenue: 0, equity: 0 };
  for (const c of cases) {
    for (const t of c.themes) byTheme[t] = (byTheme[t] ?? 0) + 1;
    const st = c.valueRealization?.status;
    if (st) valueRealization[st] = (valueRealization[st] ?? 0) + 1;
    economicValue.settlement += c.economic?.settlementAmount ?? 0;
    economicValue.resourceRevenue += c.economic?.resourceRevenue ?? 0;
    economicValue.equity += c.economic?.equityStake ?? 0;
  }
  const landmarkCases = [...cases]
    .sort((a, b) => b.citingCount - a.citingCount || a.id.localeCompare(b.id))
    .slice(0, 5)
    .map((c) => ({ id: c.id, styleOfCause: c.styleOfCause, citingCount: c.citingCount }));
  return {
    totalCases: cases.length,
    byTheme: sortKeys(byTheme),
    economicValue,
    valueRealization: sortKeys(valueRealization),
    landmarkCases,
  };
}

export function buildGraph(cases: LegalCase[], id: string): CitationGraph {
  const self = cases.find((c) => c.id === id);
  if (!self) return { cited: [], citing: [] };
  const byCitation = (cit: string) => cases.find((c) => c.citation === cit || c.citation2 === cit);
  const cited = self.casesCited.map(byCitation).filter((c): c is LegalCase => !!c);
  const citing = self.casesCiting.map(byCitation).filter((c): c is LegalCase => !!c);
  return { cited, citing };
}
