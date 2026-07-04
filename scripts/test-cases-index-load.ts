// Integration (needs Task-4 artifacts in scripts/.cache/index and the full local
// corpus in DynamoDB Local): artifact-backed index ranks EXACTLY like the scan-built
// index, and loads fast.
import assert from "node:assert/strict";
process.env.INDEX_FILE = "scripts/.cache/index";
import { getSearchIndex, invalidateSearchIndex } from "../src/lib/cases/search/build-index";
import { rankWithSearcher } from "../src/lib/cases/search/hybrid";

(async () => {
  const t0 = Date.now();
  const art = await getSearchIndex(true);
  const loadMs = Date.now() - t0;
  assert.equal(art.source, "artifact");
  assert.ok(art.cases.size > 3000, `artifact cases ${art.cases.size}`);

  const t1 = Date.now();
  const r1 = rankWithSearcher(art.searcher, "duty to consult", null);
  const queryMs = Date.now() - t1;
  assert.ok(r1.length > 100, "bm25 results over real corpus");

  process.env.INDEX_FILE = "";
  invalidateSearchIndex();
  const scan = await getSearchIndex(true);
  assert.equal(scan.source, "scan");
  for (const q of ["duty to consult", "2014 SCC 44", "aboriginal title", "treaty annuities"]) {
    assert.deepEqual(
      rankWithSearcher(art.searcher, q, null).slice(0, 50),
      rankWithSearcher(scan.searcher, q, null).slice(0, 50),
      `artifact≡scan for "${q}"`,
    );
  }
  console.log(`✅ index-load: artifact≡scan · load=${loadMs}ms · query=${queryMs}ms`);
})().catch((e) => { console.error(e); process.exit(1); });
