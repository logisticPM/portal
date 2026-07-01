import assert from "node:assert/strict";
import { a2ajToCase, chunkText, type A2ajRecord } from "../src/lib/cases/ingest/a2aj";

// a recorded A2AJ /fetch record (shape verified live against api.a2aj.ca)
const raw: A2ajRecord = {
  dataset: "SCC", citation_en: "2014 SCC 44", citation2_en: "[2014] 2 SCR 257",
  name_en: "Tsilhqot'in Nation v. British Columbia",
  document_date_en: "2014-06-26T00:00:00", url_en: "https://decisions.scc-csc.ca/x",
  unofficial_text_en: "Para one text here.\n\nPara two text here.",
  cases_cited_en: ["[1997] 3 SCR 1010"], cases_citing_en: [], citing_cases_count: 0,
  upstream_license: "non-commercial",
};

const c = a2ajToCase(raw);
assert.equal(c.id, "2014-scc-44", "id slugged from citation");
assert.equal(c.citation, "2014 SCC 44");
assert.equal(c.level, "scc", "SCC dataset → scc level");
assert.equal(c.year, 2014, "year parsed");
assert.equal(c.enrichmentLevel, "index", "raw A2AJ → index level");
assert.equal(c.fullTextAvailable, true);
assert.equal(c.casesCited[0], "[1997] 3 SCR 1010", "citation graph mapped");
assert.equal(c.provenance.source, "a2aj");
assert.equal(c.chunks?.length, 2, "two paragraph chunks");
assert.equal(c.chunks?.[0].paragraph, "para-1");

// dataset → level mapping
assert.equal(a2ajToCase({ ...raw, dataset: "FCA" }).level, "fca");
assert.equal(a2ajToCase({ ...raw, dataset: "ONCA" }).level, "provincial_appeal");
assert.equal(a2ajToCase({ ...raw, dataset: "CHRT" }).level, "tribunal");

// chunkText splits on blank lines
assert.equal(chunkText("a\n\nb\n\nc").length, 3);
console.log("✅ ingest tests passed");
