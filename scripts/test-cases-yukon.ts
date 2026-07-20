// yukon.ts unit tests. Async IIFE — this repo is NOT ESM (top-level await is illegal).
import assert from "node:assert/strict";
import { parseYukonListing, isIndigenousEconomicCandidate, yukonToCase } from "../src/lib/cases/ingest/yukon";

(async () => {
  const html = `
    <a href="/sites/default/files/favicons/favicon.png">icon</a>
    <div class="field-content">2026 YKSC 36</div>
    <a href="/sites/default/files/2026-05/2026_yksc_36_FNNND%20v%20Yukon%20%28Government%20of%29.pdf">FNNND v Yukon</a>
    <div class="field-content">2024 YKCA 3</div>
    <a href="/sites/default/files/2024-02/2024_ykca_3_ABC%20v%20XYZ.pdf">ABC v XYZ</a>
    <a href="/sites/default/files/2026-02/2026_yksc_7_CDG_v_Family%20and%20Children%20Services.pdf">CDG</a>
  `;
  const rows = parseYukonListing(html, "https://www.yukoncourts.ca/en/supreme-court/judgments");
  assert.equal(rows.length, 3, "3 decision PDFs (favicon ignored)");

  const fnnnd = rows.find((r) => r.citation === "2026 YKSC 36");
  assert.ok(fnnnd, "FNNND row parsed");
  assert.equal(fnnnd!.court, "YKSC");
  assert.equal(fnnnd!.pdfUrl, "https://www.yukoncourts.ca/sites/default/files/2026-05/2026_yksc_36_FNNND%20v%20Yukon%20%28Government%20of%29.pdf");
  assert.ok(fnnnd!.fileName.includes("FNNND v Yukon (Government of)"), "filename decoded");
  assert.equal(rows.find((r) => r.citation === "2024 YKCA 3")!.court, "YKCA", "YKCA court parsed");

  // shortlist
  assert.equal(isIndigenousEconomicCandidate(fnnnd!), true, "FNNND + Yukon(Government of) → candidate");
  assert.equal(isIndigenousEconomicCandidate(rows.find((r) => r.citation === "2024 YKCA 3")!), false, "ABC v XYZ → not candidate");
  assert.equal(isIndigenousEconomicCandidate(rows.find((r) => r.citation === "2026 YKSC 7")!), false, "family services → not candidate");

  // yukonToCase
  const c = yukonToCase(fnnnd!, "The First Nation sought judicial review of the land use plan. ".repeat(10));
  assert.equal(c.id, "2026-yksc-36", "slug id");
  assert.equal(c.court, "YKSC");
  assert.equal(c.level, "provincial_superior");
  assert.equal(c.year, 2026);
  assert.equal(c.provenance.source, "official_court");
  assert.equal(c.provenance.sourceUrl, fnnnd!.pdfUrl);
  assert.equal(c.corpusTier, "substrate");
  assert.ok((c.chunks?.length ?? 0) > 0, "chunks present");
  assert.ok(/FNNND v Yukon/.test(c.styleOfCause), "styleOfCause derived from filename");

  console.log("✅ test-cases-yukon passed");
})().catch((e) => { console.error(e); process.exit(1); });
