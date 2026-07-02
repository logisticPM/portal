import { routeQuery } from "../src/lib/cases/search/route";
import type { SearchIndex } from "../src/lib/cases/search/build-index";
import type { LegalCase } from "../src/lib/cases/types";

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`FAIL ${msg}: got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`);
}

// Minimal index: routeQuery only reads index.cases (styleOfCause) for name matching.
function fixtureIndex(): SearchIndex {
  const cases = new Map<string, LegalCase>();
  const add = (id: string, styleOfCause: string) => cases.set(id, { id, styleOfCause } as LegalCase);
  add("1990-1-scr-1075", "R. v. Sparrow");
  add("1997-3-scr-1010", "Delgamuukw v. British Columbia");
  add("2005-scc-69", "Mikisew Cree First Nation v. Canada (Minister of Canadian Heritage)");
  return { units: [], cases, embedderId: null, vdim: null };
}

(async () => {
  const idx = fixtureIndex();

  // --- citations route to BM25-only ---
  eq(routeQuery("2014 SCC 44", idx), { useDense: false, reason: "citation" }, "neutral citation");
  eq(routeQuery("2004 scc 73", idx), { useDense: false, reason: "citation" }, "lowercase neutral citation");
  eq(routeQuery("[1990] 1 SCR 1075", idx), { useDense: false, reason: "citation" }, "SCR reporter");
  eq(routeQuery("2004-scc-73", idx), { useDense: false, reason: "citation" }, "slug id");

  console.log("✅ route: citation detection");
})().catch((e) => { console.error(e); process.exit(1); });
