// Official-source backfill v1 (spec 2026-07-07 rev): allowlist + verbatim HTML→text.
// Async IIFE — this repo is NOT ESM (top-level await is illegal).
import assert from "node:assert/strict";
import { isOpenSource, htmlToText, fetchOfficialText, toDocumentUrl } from "../src/lib/cases/ingest/official-source";

(async () => {
  // --- isOpenSource (v2 = bccourts + SCC) ---
  assert.equal(isOpenSource("https://www.bccourts.ca/jdb-txt/sc/24/14/2024BCSC1490.htm"), true);
  assert.equal(isOpenSource("https://decisions.scc-csc.ca/scc-csc/scc-csc/en/item/14246/index.do"), true, "SCC now open in v2");
  assert.equal(isOpenSource("https://www.canlii.org/en/bc/bcsc/doc/x.html"), false, "CanLII excluded");
  assert.equal(isOpenSource("not a url"), false);

  // --- toDocumentUrl: viewer form → direct-PDF form; passthrough otherwise ---
  assert.equal(
    toDocumentUrl("https://decisions.scc-csc.ca/scc-csc/scc-csc/en/item/2189/index.do"),
    "https://decisions.scc-csc.ca/scc-csc/scc-csc/en/2189/1/document.do",
    "index.do → document.do");
  assert.equal(
    toDocumentUrl("https://decisions.scc-csc.ca/scc-csc/scc-csc/en/2189/1/document.do"),
    "https://decisions.scc-csc.ca/scc-csc/scc-csc/en/2189/1/document.do",
    "document.do passes through unchanged");
  assert.equal(
    toDocumentUrl("https://www.bccourts.ca/jdb-txt/sc/24/14/2024BCSC1490.htm"),
    "https://www.bccourts.ca/jdb-txt/sc/24/14/2024BCSC1490.htm",
    "non-SCC passes through unchanged");
  assert.equal(
    toDocumentUrl("https://decisions.scc-csc.ca/scc-csc/scc-csc/en/item/2189/index.do/"),
    "https://decisions.scc-csc.ca/scc-csc/scc-csc/en/2189/1/document.do",
    "trailing slash normalizes too");
  assert.equal(toDocumentUrl("not a url"), "not a url", "malformed input → returned unchanged");

  // --- htmlToText: strips noise, keeps paragraphs verbatim, decodes entities ---
  const html = `<html><head><title>x</title><style>.a{color:red}</style></head><body>
    <nav>Home | Search</nav>
    <div class="content"><p>The Nation brought a claim for aboriginal title.</p>
    <p>The court granted the declaration &amp; costs of $5,000.</p></div>
    <footer>Copyright BC Courts</footer></body></html>`;
  const text = htmlToText(html);
  assert.ok(text.includes("The Nation brought a claim for aboriginal title."), "para 1 kept verbatim");
  assert.ok(text.includes("The court granted the declaration & costs of $5,000."), "para 2 kept + entity decoded");
  assert.ok(!/Home \| Search/.test(text), "nav stripped");
  assert.ok(!/BC Courts/.test(text), "footer stripped");
  assert.ok(!/[<>]/.test(text), "no residual tags");
  assert.ok(text.split("\n\n").length >= 2, "paragraph-structured (\\n\\n separated)");

  // --- fetchOfficialText: injected get ---
  const body = "The reasons for judgment. ".repeat(20); // > 200 chars
  assert.equal(await fetchOfficialText("https://www.bccourts.ca/a.htm", async () => `<p>${body}</p>`), body.trim(), "open host → extracted text");
  assert.equal(await fetchOfficialText("https://www.canlii.org/x", async () => "<p>should never fetch</p>"), "", "non-open host → '' (not fetched)");
  assert.equal(await fetchOfficialText("https://www.bccourts.ca/s.htm", async () => "<p>tiny</p>"), "", "too-short extraction → ''");
  assert.equal(await fetchOfficialText("https://www.bccourts.ca/e.htm", async () => { throw new Error("net"); }), "", "fetch error → ''");

  console.log("✅ test-cases-official-source passed");
})().catch((e) => { console.error(e); process.exit(1); });
