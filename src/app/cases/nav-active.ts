// Which nav tab owns a given path. Pure and separately importable so it can be tested
// without pulling in next/navigation (CasesNav is a client component).
export const CASES_TABS = [
  { href: "/cases", label: "Cases" },
  { href: "/cases/similar", label: "Find similar" },
  { href: "/cases/activation", label: "Activation" },
  { href: "/cases/briefings", label: "Legal info" },
  { href: "/cases/monitoring", label: "Monitoring" },
  { href: "/cases/methodology", label: "Methodology" },
] as const;

// Longest-prefix wins, and "/cases" is the fallback rather than a competitor.
//
// Two things a naive `startsWith` gets wrong here: every route in this section begins with
// "/cases", so plain prefix matching lights up the Cases tab on every page; and a
// case-detail URL (/cases/2024-scc-1) owns no tab at all, so it has to fall back to Cases
// rather than leaving the whole nav unhighlighted.
export function activeHref(pathname: string): string {
  let best = "/cases";
  for (const t of CASES_TABS) {
    if (t.href === "/cases") continue;
    const hit = pathname === t.href || pathname.startsWith(t.href + "/");
    if (hit && t.href.length > best.length) best = t.href;
  }
  return best;
}
