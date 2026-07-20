// Official-source backfill v1 (spec 2026-07-07 rev): allowlist + verbatim HTML→text.
// Async IIFE — this repo is NOT ESM (top-level await is illegal).
import assert from "node:assert/strict";
import { isOpenSource, htmlToText, fetchOfficialText, toDocumentUrl, cleanupPdfText, pdfToText } from "../src/lib/cases/ingest/official-source";

(async () => {
  const allowAll = async (_u: string) => true; // robots gate stub for offline extraction tests

  // --- isOpenSource (v3 = bccourts + SCC + ONCA) ---
  assert.equal(isOpenSource("https://www.bccourts.ca/jdb-txt/sc/24/14/2024BCSC1490.htm"), true);
  assert.equal(isOpenSource("https://decisions.scc-csc.ca/scc-csc/scc-csc/en/item/14246/index.do"), true, "SCC open");
  assert.equal(isOpenSource("https://coadecisions.ontariocourts.ca/coa/coa/en/item/1234/index.do"), true, "ONCA open in v3");
  assert.equal(isOpenSource("https://www.yukoncourts.ca/sites/default/files/2026-05/2026_yksc_36_FNNND.pdf"), true, "Yukon open (direct-harvest source)");
  assert.equal(isOpenSource("https://www.canlii.org/en/bc/bcsc/doc/x.html"), false, "CanLII excluded");
  assert.equal(isOpenSource("not a url"), false);

  // --- toDocumentUrl: viewer form → direct-PDF form; passthrough otherwise ---
  assert.equal(
    toDocumentUrl("https://decisions.scc-csc.ca/scc-csc/scc-csc/en/item/2189/index.do"),
    "https://decisions.scc-csc.ca/scc-csc/scc-csc/en/2189/1/document.do",
    "index.do → document.do");
  assert.equal(
    toDocumentUrl("https://coadecisions.ontariocourts.ca/coa/coa/en/item/1234/index.do"),
    "https://coadecisions.ontariocourts.ca/coa/coa/en/1234/1/document.do",
    "ONCA viewer → document.do (generalized transform)");
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

  // --- fetchOfficialText: injected get returns { buf, contentType } (bytes + type) ---
  const body = "The reasons for judgment. ".repeat(20); // > 200 chars after trim
  const htmlGet = async () => ({ buf: Buffer.from(`<p>${body}</p>`, "utf8"), contentType: "text/html; charset=utf-8" });
  assert.equal(await fetchOfficialText("https://www.bccourts.ca/a.htm", htmlGet, allowAll), body.trim(), "open HTML host → extracted text");
  assert.equal(await fetchOfficialText("https://www.canlii.org/x", htmlGet, allowAll), "", "non-open host → '' (not fetched)");
  assert.equal(await fetchOfficialText("https://www.bccourts.ca/s.htm", async () => ({ buf: Buffer.from("<p>tiny</p>"), contentType: "text/html" }), allowAll), "", "too-short extraction → ''");
  assert.equal(await fetchOfficialText("https://www.bccourts.ca/e.htm", async () => { throw new Error("net"); }, allowAll), "", "fetch error → ''");

  // robots gate: a disallowed URL is never fetched (replaces the old hardcoded deny-list).
  let denyFetched = false;
  const denyGate = async (_u: string) => false;
  assert.equal(
    await fetchOfficialText("https://www.bccourts.ca/jdb-txt/sc/24/14/2024BCSC1490.htm",
      async () => { denyFetched = true; return { buf: Buffer.from("x".repeat(300)), contentType: "text/html" }; },
      denyGate),
    "", "robots-disallowed URL → ''");
  assert.equal(denyFetched, false, "robots-disallowed URL not fetched");

  // PDF routing by content-type: PDF-typed bytes go to pdfToText (NOT htmlToText).
  const htmlBytes = Buffer.from(`<p>${body}</p>`, "utf8");
  assert.equal(
    await fetchOfficialText("https://decisions.scc-csc.ca/scc-csc/scc-csc/en/item/2189/index.do",
      async (u: string) => { assert.ok(u.endsWith("/2189/1/document.do"), "normalized to document.do"); return { buf: htmlBytes, contentType: "application/pdf" }; },
      allowAll),
    "", "application/pdf content-type routes to PDF parser (HTML bytes rejected → '')");
  assert.equal(
    await fetchOfficialText("https://www.bccourts.ca/a.htm", async () => ({ buf: htmlBytes, contentType: "text/html" }), allowAll),
    body.trim(), "same bytes as text/html route to htmlToText → body (routing control)");
  assert.equal(
    await fetchOfficialText("https://decisions.scc-csc.ca/scc-csc/scc-csc/en/2189/1/document.do",
      async () => ({ buf: htmlBytes, contentType: "" }), allowAll),
    "", "document.do URL suffix forces the PDF branch even without a pdf content-type");

  // --- cleanupPdfText: deterministic verbatim cleanup (pure string→string) ---
  const raw = [
    "SUPREME COURT OF CANADA",                 // running header (dropped)
    "The Nation sought compensa-",             // hyphenated line break (joined)
    "tion for the taking of its land.",
    "",
    "12",                                       // page-number-only line (dropped)
    "",
    "The oﬀice granted the declaration.", // ligature ﬀ → ff
  ].join("\n");
  const cleaned = cleanupPdfText(raw);
  assert.ok(cleaned.includes("compensa-tion for the taking of its land."), "newline removed, hyphen preserved (verbatim-conservative)");
  assert.ok(cleaned.includes("The office granted the declaration."), "ligature normalized");
  assert.ok(!/SUPREME COURT OF CANADA/.test(cleaned), "running header dropped");
  assert.ok(!/^\s*12\s*$/m.test(cleaned), "page-number-only line dropped");
  assert.ok(!/compensa-\s*\n/.test(cleaned), "no dangling hyphen");
  // genuine hyphenated compound must survive intact (the Critical case)
  assert.ok(cleanupPdfText("The right to self-\ndetermination is protected.").includes("self-determination"), "real compound hyphen preserved");
  // CRLF input is normalized and joined
  assert.ok(cleanupPdfText("The claim for compensa-\r\ntion succeeded here today.").includes("compensa-tion succeeded"), "CRLF normalized + joined");
  // a 4-digit year on its own line is NOT dropped
  assert.ok(/\b1982\b/.test(cleanupPdfText("Constitution Act\n\n1982\n\nsection thirty-five confers the right.")), "standalone 4-digit year kept");

  // --- pdfToText: delegates to the injected parser then cleans ---
  const fakeParse = async (_buf: Buffer) => ({
    text: "SUPREME COURT OF CANADA\nHello world of judg-\nment reasoning here.",
    numpages: 1, numrender: 1, info: null, metadata: null, version: "x",
  });
  const pt = await pdfToText(Buffer.from("%PDF-fake"), fakeParse);
  assert.ok(pt.includes("Hello world of judg-ment reasoning here."), "pdfToText cleans parser output");
  assert.ok(!/SUPREME COURT OF CANADA/.test(pt), "pdfToText drops running header");

  console.log("✅ test-cases-official-source passed");
})().catch((e) => { console.error(e); process.exit(1); });
