// court-harvest + adapters unit tests. Async IIFE — this repo is NOT ESM.
import assert from "node:assert/strict";
import { isCandidate, courtToCase } from "../src/lib/cases/ingest/court-harvest";
import { yukonAdapter, nbAdapter, mbAdapter } from "../src/lib/cases/ingest/court-adapters";

(async () => {
  // --- Yukon adapter: single-page, YKSC/YKCA, no sub-index (behavior-preserving) ---
  const ykHtml = `
    <a href="/sites/default/files/favicons/favicon.png">icon</a>
    <a href="/sites/default/files/2026-05/2026_yksc_36_FNNND%20v%20Yukon%20%28Government%20of%29.pdf">a</a>
    <a href="/sites/default/files/2024-02/2024_ykca_3_ABC%20v%20XYZ.pdf">b</a>`;
  const yk = yukonAdapter.parseListing(ykHtml, "https://www.yukoncourts.ca/en/supreme-court/judgments");
  assert.equal(yk.rows.length, 2, "yukon: 2 decision PDFs (favicon ignored)");
  assert.equal(yk.subIndexUrls.length, 0, "yukon: no sub-index pages");
  const fnnnd = yk.rows.find((r) => r.citation === "2026 YKSC 36")!;
  assert.equal(fnnnd.court, "YKSC");
  assert.equal(fnnnd.pdfUrl, "https://www.yukoncourts.ca/sites/default/files/2026-05/2026_yksc_36_FNNND%20v%20Yukon%20%28Government%20of%29.pdf");
  assert.equal(yk.rows.find((r) => r.citation === "2024 YKCA 3")!.court, "YKCA");
  assert.equal(isCandidate(fnnnd, yukonAdapter), true, "yukon: FNNND / Yukon(Government of) → candidate");
  assert.equal(isCandidate(yk.rows.find((r) => r.citation === "2024 YKCA 3")!, yukonAdapter), false, "yukon: ABC v XYZ → not");

  // --- NB adapter: landing → monthly sub-index; monthly → NBCA PDFs ---
  const nbLanding = `
    <a href="/content/cour/en/appeal/content/decisions/2025/june.html">June 2025</a>
    <a href="/content/cour/en/appeal/content/decisions/2024/may.html">May 2024</a>
    <a href="/content/dam/courts/pdf/appeal-appel/InterjurisdictionalChildAbduction.pdf">form</a>`;
  const nbL = nbAdapter.parseListing(nbLanding, "https://www.courtsnb-coursnb.ca/content/cour/en/appeal/content/decisions.html");
  assert.equal(nbL.rows.length, 0, "nb landing: no decision PDFs (form has no citation)");
  assert.deepEqual(nbL.subIndexUrls.sort(), [
    "https://www.courtsnb-coursnb.ca/content/cour/en/appeal/content/decisions/2024/may.html",
    "https://www.courtsnb-coursnb.ca/content/cour/en/appeal/content/decisions/2025/june.html",
  ].sort(), "nb landing: monthly index pages");
  const nbMonth = `
    <a href="/content/dam/courts/pdf/appeal-appel/decisions/2025/06/2025-06-26-farshad-gohari-v-r-2025-nbca-81.pdf">x</a>
    <a href="/content/dam/courts/pdf/appeal-appel/decisions/2024/05/2024-05-01-elsipogtog-first-nation-v-nb-2024-nbca-20.pdf">y</a>`;
  const nbM = nbAdapter.parseListing(nbMonth, "https://www.courtsnb-coursnb.ca/content/cour/en/appeal/content/decisions/2025/june.html");
  assert.equal(nbM.rows.length, 2, "nb monthly: 2 NBCA PDFs");
  const nbGohari = nbM.rows.find((r) => r.citation === "2025 NBCA 81")!;
  assert.equal(nbGohari.court, "NBCA");
  assert.equal(isCandidate(nbGohari, nbAdapter), false, "nb: criminal R appeal → not candidate");
  assert.equal(isCandidate(nbM.rows.find((r) => r.citation === "2024 NBCA 20")!, nbAdapter), true, "nb: Elsipogtog First Nation → candidate");

  // --- MB adapter: single recent page, MBCA PDFs ---
  const mbHtml = `
    <a href="/site/assets/files/1036/r_v_marjanovic_2026_mbca_61.pdf">x</a>
    <a href="/site/assets/files/1036/peguis_first_nation_v_manitoba_2024_mbca_10.pdf">y</a>`;
  const mb = mbAdapter.parseListing(mbHtml, "https://www.manitobacourts.mb.ca/court-of-appeal/recent-judgments/");
  assert.equal(mb.rows.length, 2, "mb: 2 MBCA PDFs");
  const mbMarj = mb.rows.find((r) => r.citation === "2026 MBCA 61")!;
  assert.equal(mbMarj.court, "MBCA");
  assert.equal(isCandidate(mbMarj, mbAdapter), false, "mb: criminal R appeal → not candidate");
  assert.equal(isCandidate(mb.rows.find((r) => r.citation === "2024 MBCA 10")!, mbAdapter), true, "mb: Peguis First Nation → candidate");

  // --- courtToCase: valid LegalCase, level from adapter, provenance official_court ---
  const c = courtToCase(nbGohari, "The Court of Appeal considered the sentence. ".repeat(12), nbAdapter);
  assert.equal(c.id, "2025-nbca-81", "slug id");
  assert.equal(c.court, "NBCA");
  assert.equal(c.level, "provincial_appeal");
  assert.equal(c.year, 2025);
  assert.equal(c.provenance.source, "official_court");
  assert.equal(c.corpusTier, "substrate");
  assert.ok((c.chunks?.length ?? 0) > 0, "chunks present");
  const cy = courtToCase(fnnnd, "text here ".repeat(30), yukonAdapter);
  assert.equal(cy.level, "provincial_superior", "yukon YKSC → provincial_superior");

  console.log("✅ test-cases-court-harvest passed");
})().catch((e) => { console.error(e); process.exit(1); });
