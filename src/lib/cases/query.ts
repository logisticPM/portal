// PURE query logic over LegalCase[] — shared by repo.mock and repo.dynamo so the
// two impls are identical by construction (the verify.ts golden test).
import { caseFixtures } from "./fixtures";
import type {
  LegalCase, CaseFilter, Facets, ActivationSummary, CitationGraph, CorpusStats,
  Theme, CourtLevel, WinType, RealizationStatus, FigureKind, EconomicFigures, FigureRange,
} from "./types";

export { caseFixtures }; // convenience re-export for tests

export function filterCases(cases: LegalCase[], f?: CaseFilter): LegalCase[] {
  return cases.filter((c) =>
    (f?.tier === "all" ? true : f?.tier ? c.corpusTier === f.tier : c.corpusTier === "core") &&  // default: core-only
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

// The LLM's awarded/ordered label is noisy — a fidelity spot-check (2026-07-07)
// found contextual recitals (e.g. a mentioned $23.34B settlement Canada "entered
// into") mislabeled "awarded", which inflated the dashboard ranges. This mechanical
// gate is the trustworthy signal for aggregation: the quote must carry a grant/order
// verb AND no background-recital marker. Per-case display is unaffected (readers see
// every figure with its quote); only the aggregated ranges use this gate.
const GRANT_RE = /\b(awarded|awarding|granted|ordered to pay|shall pay|to be paid|received|judgment (?:for|of|in the amount)|damages (?:of|in the amount)|compensation of|liable (?:to pay|for)|entitled to|transfer of)\b/i;
const CONTEXT_RE = /\b(entered into|was advised|has paid|have paid|had paid|committed|provided over|agreement in principle|available|set aside|budget)\b/i;
export function isCourtGranted(quote: string): boolean {
  return GRANT_RE.test(quote) && !CONTEXT_RE.test(quote);
}

export function buildActivation(cases: LegalCase[]): ActivationSummary {
  const byTheme: Partial<Record<Theme, number>> = {};
  const valueRealization: Partial<Record<RealizationStatus, number>> = {};
  // One amount per case per kind (largest court-awarded/ordered figure, or curated
  // amount). Ranges only — never a cross-case or cross-kind sum (spec §3, Gallagher).
  const perKind = new Map<FigureKind, Map<string, number>>();
  const kindUnit = new Map<FigureKind, string>();
  const addAmount = (kind: FigureKind, caseId: string, amount: number, unit: string) => {
    let m = perKind.get(kind); if (!m) { m = new Map(); perKind.set(kind, m); }
    const cur = m.get(caseId);
    if (cur === undefined || amount > cur) m.set(caseId, amount);
    kindUnit.set(kind, unit);
  };
  for (const c of cases) {
    for (const t of c.themes) byTheme[t] = (byTheme[t] ?? 0) + 1;
    const st = c.valueRealization?.status;
    if (st) valueRealization[st] = (valueRealization[st] ?? 0) + 1;
    for (const fig of c.extractedFigures ?? []) {
      if (fig.role !== "awarded" && fig.role !== "ordered") continue;
      // Equity is a percentage range; a $-amount mislabeled "equity" (no unit) must
      // not pollute it (would mix "%" and CAD in one range).
      if (fig.kind === "equity" && fig.unit !== "percent") continue;
      // Mechanical grant gate: the model's role label alone is unreliable, so only
      // amounts the judgment actually grants (not recited context) enter the ranges.
      if (!isCourtGranted(fig.quote)) continue;
      addAmount(fig.kind, c.id, fig.amount, fig.unit === "percent" ? "%" : fig.currency);
    }
    if (c.economic?.settlementAmount != null) addAmount("settlement", c.id, c.economic.settlementAmount, "CAD");
    if (c.economic?.resourceRevenue != null) addAmount("resource_revenue", c.id, c.economic.resourceRevenue, "CAD");
    if (c.economic?.equityStake != null) addAmount("equity", c.id, c.economic.equityStake, "%");
  }
  const landmarkCases = [...cases]
    .sort((a, b) => b.citingCount - a.citingCount || a.id.localeCompare(b.id))
    .slice(0, 5)
    .map((c) => ({ id: c.id, styleOfCause: c.styleOfCause, citingCount: c.citingCount }));
  const byKind: Partial<Record<FigureKind, FigureRange>> = {};
  const casesWith = new Set<string>();
  for (const [kind, m] of perKind) {
    const amounts = [...m.values()].sort((a, b) => a - b);
    for (const id of m.keys()) casesWith.add(id);
    const mid = Math.floor(amounts.length / 2);
    const median = amounts.length % 2 ? amounts[mid] : (amounts[mid - 1] + amounts[mid]) / 2;
    byKind[kind] = { countCases: m.size, min: amounts[0], max: amounts[amounts.length - 1], median, unit: kindUnit.get(kind) ?? "CAD" };
  }
  // sortKeys: deterministic byKind ordering so JSON.stringify matches across mock and
  // dynamo (Scan order is not guaranteed) — the dynamo≡mock parity check depends on it.
  const economicFigures: EconomicFigures = { totalCases: cases.length, casesWithFigures: casesWith.size, byKind: sortKeys(byKind) };
  return {
    totalCases: cases.length,
    byTheme: sortKeys(byTheme),
    economicFigures,
    valueRealization: sortKeys(valueRealization),
    landmarkCases,
  };
}

export function buildCorpusStats(cases: LegalCase[]): CorpusStats {
  const byLevel: Partial<Record<CourtLevel, number>> = {};
  const byDecade: Record<string, number> = {};
  let core = 0, substrate = 0, fullText = 0;
  for (const c of cases) {
    if (c.corpusTier === "core") core++; else substrate++;
    if (c.fullTextAvailable) fullText++;
    byLevel[c.level] = (byLevel[c.level] ?? 0) + 1;
    const d = `${Math.floor(c.year / 10) * 10}s`;
    byDecade[d] = (byDecade[d] ?? 0) + 1;
  }
  return { total: cases.length, core, substrate, fullText, byLevel: sortKeys(byLevel), byDecade: sortKeys(byDecade) };
}

export function buildGraph(cases: LegalCase[], id: string): CitationGraph {
  const self = cases.find((c) => c.id === id);
  if (!self) return { cited: [], citing: [] };
  const byCitation = (cit: string) => cases.find((c) => c.citation === cit || c.citation2 === cit);
  const cited = self.casesCited.map(byCitation).filter((c): c is LegalCase => !!c);
  const citing = self.casesCiting.map(byCitation).filter((c): c is LegalCase => !!c);
  return { cited, citing };
}
