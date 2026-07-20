// robots.ts unit tests. Async IIFE — this repo is NOT ESM (top-level await is illegal).
import assert from "node:assert/strict";
import { makeRobotsGate } from "../src/lib/cases/ingest/robots";

// Build a gate whose robots.txt fetcher always returns a fixed status/body.
const fixed = (status: number, body: string) => makeRobotsGate(async () => ({ status, body }));

(async () => {
  // --- bccourts regression: Disallow: /jdb-txt/ blocks the exact path we backfilled ---
  const bc = fixed(200, "User-agent: *\nDisallow: /jdb-txt/\n");
  assert.equal(await bc.allows("https://www.bccourts.ca/jdb-txt/sc/24/14/2024BCSC1490.htm"), false, "jdb-txt disallowed");
  assert.equal(await bc.allows("https://www.bccourts.ca/court_of_appeal/about_judgments.aspx"), true, "non-jdb-txt allowed");

  // --- fetch-status policy: 404 allow / 403,5xx,network skip ---
  assert.equal(await fixed(404, "").allows("https://records.court.nl.ca/public/x?decision-id=1&mode=stream"), true, "404 → allowed");
  assert.equal(await fixed(403, "").allows("https://decisions.scc-csc.ca/scc-csc/scc-csc/en/2189/1/document.do"), false, "403 → skip");
  assert.equal(await fixed(500, "").allows("https://example.court.ca/x"), false, "5xx → skip");
  assert.equal(await fixed(0, "").allows("https://example.court.ca/x"), false, "network error → skip");

  // --- library correctness: Allow-override + longest-match ---
  const ao = fixed(200, "User-agent: *\nDisallow: /a/\nAllow: /a/b\n");
  assert.equal(await ao.allows("https://h.ca/a/b/doc"), true, "longer Allow wins");
  assert.equal(await ao.allows("https://h.ca/a/c/doc"), false, "only Disallow matches");

  // --- library correctness: wildcard + end-anchor ---
  const wc = fixed(200, "User-agent: *\nDisallow: /*.aspx$\n");
  assert.equal(await wc.allows("https://h.ca/court/Recent_Judgments.aspx"), false, "*.aspx$ blocked");
  assert.equal(await wc.allows("https://h.ca/court/2024BCSC1.htm"), true, ".htm allowed");

  // --- per-host memoization: robots.txt fetched once per host ---
  let calls = 0;
  const memo = makeRobotsGate(async () => { calls++; return { status: 200, body: "User-agent: *\nDisallow: /x/\n" }; });
  await memo.allows("https://h.ca/x/1");
  await memo.allows("https://h.ca/y/2");
  await memo.allows("https://h.ca/x/3");
  assert.equal(calls, 1, "one fetch for repeated host");
  await memo.allows("https://other.ca/z");
  assert.equal(calls, 2, "different host → separate fetch");

  // --- malformed URL → skip ---
  assert.equal(await fixed(200, "").allows("not a url"), false, "malformed URL → false");

  console.log("✅ test-cases-robots passed");
})().catch((e) => { console.error(e); process.exit(1); });
