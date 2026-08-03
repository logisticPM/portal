// ACCEPTANCE GATE for the bilingual column splitter, against a real judgment.
//
// Unit tests are not sufficient here and this script exists because of that. The page-level
// predecessor passed eight synthetic assertions and was still wrong — the fixtures encoded
// the same mistaken layout model as the code. Only the real PDF caught it.
//
// Fetches Tsilhqot'in 2014 SCC 44 once (truthful UA, cached to scripts/.cache) and asserts
// on the extraction. Run before any backfill; NOT part of the offline test suite, because it
// makes one network request.
import "./fetch-polyfill";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pdfToText, pdfToPages, pdfToPageItems, cleanupPdfText } from "../src/lib/cases/ingest/official-source";
import { keepEnglishColumns, renderItems } from "../src/lib/cases/ingest/bilingual";
import { CRAWLER_UA } from "../src/lib/cases/ingest/crawler-id";

const URL_ = "https://decisions.scc-csc.ca/scc-csc/scc-csc/en/14246/1/document.do";
const CACHE = path.join(process.cwd(), "scripts", ".cache", "tsilhqotin-2014-scc-44.pdf");

async function getPdf(): Promise<Buffer> {
  try { return await fs.readFile(CACHE); } catch { /* fetch below */ }
  const res = await fetch(URL_, { headers: { "User-Agent": CRAWLER_UA } });
  if (!res.ok) throw new Error(`fetch failed: ${res.status} — cannot run the gate without the document`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(path.dirname(CACHE), { recursive: true });
  await fs.writeFile(CACHE, buf);
  return buf;
}

async function main() {
  const buf = await getPdf();
  console.log(`pdf bytes: ${buf.length}`);

  // 1. Geometry extraction must agree with the plain extraction, page for page.
  const pages = await pdfToPages(buf);
  const items = await pdfToPageItems(buf);
  assert.ok(pages.length > 0, "pdfToPages returned nothing");
  assert.equal(items.length, pages.length, "page counts differ between the two extractors");
  for (let i = 0; i < pages.length; i++)
    assert.equal(renderItems(items[i]), pages[i], `page ${i}: renderItems does not reproduce pdfToPages`);
  console.log(`✓ ${pages.length} pages · renderItems reproduces pdfToPages exactly`);

  // 2. Rejoining the pages and cleaning reproduces whole-document extraction byte for byte.
  const whole = await pdfToText(buf);
  assert.equal(cleanupPdfText(pages.join("\n\n")), whole, "page rejoin diverges from pdfToText");
  console.log(`✓ page rejoin is byte-identical to pdfToText (${whole.length} chars)`);

  // 3. The English extraction.
  const split = keepEnglishColumns(items);
  const english = cleanupPdfText(split.text);
  console.log(`  kept ${split.kept} · dropped ${split.dropped} · whole-page fallbacks ${split.wholePageFallbacks}`);
  console.log(`  english chars: ${english.length} (bilingual whole: ${whole.length})`);

  assert.ok(english.length > 100_000, `too little English (${english.length}) — the split is dropping content`);
  assert.ok(english.length < 200_000, `too much English (${english.length}) — French is probably surviving`);
  assert.ok(english.length < 240_000, "must fit assembleInput's budget");

  const fr = (english.match(/\b(pourvoi|intimée|arrêt|toutefois|néanmoins|selon les)\b/gi) ?? []).length;
  assert.equal(fr, 0, `${fr} French markers survived the split`);

  assert.match(english.slice(0, 400), /\b(the|The|Court|appeal)\b/, "the extraction should open in English");
  console.log(`✓ English-only, in budget, opens in English`);
  console.log(`\nhead: ${english.slice(0, 200)}`);
  console.log("\n✅ bilingual acceptance gate passed");
}
main().catch((e) => { console.error("❌ bilingual gate FAILED:", e.message); process.exit(1); });
