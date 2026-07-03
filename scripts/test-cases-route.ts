import assert from "node:assert/strict";
import { routeQuery } from "../src/lib/cases/search/route";
import type { SearchIndex } from "../src/lib/cases/search/build-index";
import type { LegalCase } from "../src/lib/cases/types";

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
  assert.deepEqual(routeQuery("2014 SCC 44", idx), { useDense: false, reason: "citation" }, "neutral citation");
  assert.deepEqual(routeQuery("2004 scc 73", idx), { useDense: false, reason: "citation" }, "lowercase neutral citation");
  assert.deepEqual(routeQuery("[1990] 1 SCR 1075", idx), { useDense: false, reason: "citation" }, "SCR reporter");
  assert.deepEqual(routeQuery("2004-scc-73", idx), { useDense: false, reason: "citation" }, "slug id");

  // --- corpus-grounded case-name matching routes to BM25-only ---
  assert.equal(routeQuery("Sparrow", idx).useDense, false, "surname matches styleOfCause");
  assert.equal(routeQuery("Sparrow", idx).reason, "case_name", "surname reason is case_name");
  assert.equal(routeQuery("Delgamuukw", idx).useDense, false, "single-party name matches styleOfCause");
  assert.equal(routeQuery("Mikisew Cree", idx).useDense, false, "multi-token prefix matches styleOfCause");

  // --- topical / conceptual queries stay dense ---
  assert.deepEqual(routeQuery("duty to consult", idx), { useDense: true, reason: "semantic" }, "topical phrase");
  assert.deepEqual(
    routeQuery("When must government consult Indigenous groups before a pipeline?", idx),
    { useDense: true, reason: "semantic" },
    "natural-language question",
  );

  // --- guards: long query containing a surname is a question, not a known-item lookup ---
  assert.equal(
    routeQuery("what did the court decide about fishing rights in the Sparrow appeal case", idx).useDense,
    true,
    "long query with embedded surname is not a name lookup (>5 tokens)",
  );

  // --- guards: all-generic-token query is not a case-name lookup ---
  assert.equal(routeQuery("Canada", idx).useDense, true, "generic-only query is not a case-name lookup");

  console.log("✅ route: citation + case-name");
})().catch((e) => { console.error(e); process.exit(1); });
