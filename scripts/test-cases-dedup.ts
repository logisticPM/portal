import assert from "node:assert/strict";
import { normalizeCitation, dedupeByCitation } from "../src/lib/cases/ingest/dedup";
import type { A2ajRecord } from "../src/lib/cases/ingest/a2aj";

const r = (c: string): A2ajRecord => ({ dataset: "SCC", citation_en: c, name_en: "X", document_date_en: "2014-01-01T00:00:00", url_en: "u" });

assert.equal(normalizeCitation(" 2014 SCC 44 "), "2014 scc 44", "normalize trims+lowercases");
// duplicate citation collapses; distinct citations (incl. multi-level) preserved
const out = dedupeByCitation([r("2014 SCC 44"), r("2014 SCC 44"), r("2014 BCCA 1"), r("2013 BCSC 9")]);
assert.equal(out.length, 3, "dup citation collapsed, 3 distinct kept");
assert.deepEqual(out.map((x) => x.citation_en).sort(), ["2013 BCSC 9", "2014 BCCA 1", "2014 SCC 44"]);
console.log("✅ dedup tests passed");
