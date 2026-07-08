// Regression test for scripts/fetch-polyfill.ts (faithful fetch over node:https/node:http).
// A prior bug dropped init.headers (no User-Agent sent -> some official sites 403'd) and
// returned a Response with no working arrayBuffer()/headers, silently zeroing a data
// backfill. This test spins up a local node:http server (deterministic, no network) and
// exercises the real nodeFetch via the installed global fetch.
// Async IIFE — this repo is NOT ESM (top-level await is illegal).
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import "./fetch-polyfill";

const TEST_TIMEOUT_MS = 5000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms: ${label}`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

(async () => {
  const server = http.createServer((req, res) => {
    const url = req.url ?? "/";

    if (url === "/echo-ua") {
      const ua = req.headers["user-agent"] ?? "";
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(`ua=${ua}`);
      return;
    }

    if (url === "/binary") {
      const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x10]);
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      res.end(bytes);
      return;
    }

    if (url === "/pdf-type") {
      res.writeHead(200, { "Content-Type": "application/pdf" });
      res.end("pdf body");
      return;
    }

    if (url === "/ok") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok body");
      return;
    }

    if (url === "/missing") {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found");
      return;
    }

    if (url === "/redirect") {
      res.writeHead(302, { Location: "/final" });
      res.end();
      return;
    }

    if (url === "/final") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ARRIVED");
      return;
    }

    if (url === "/loop") {
      res.writeHead(302, { Location: "/loop" });
      res.end();
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  try {
    // --- 1. Header passthrough: the bug that caused 403s ---
    const uaRes = await withTimeout(
      fetch(`${base}/echo-ua`, { headers: { "User-Agent": "TestUA/1.0" } }),
      TEST_TIMEOUT_MS,
      "header passthrough request",
    );
    const uaBody = await uaRes.text();
    assert.equal(uaBody, "ua=TestUA/1.0", "server must echo back exactly the User-Agent header the client sent via init.headers");

    // --- 2. arrayBuffer byte-fidelity (guards pooled-slab slice correctness) ---
    const binRes = await withTimeout(fetch(`${base}/binary`), TEST_TIMEOUT_MS, "binary request");
    const ab = await binRes.arrayBuffer();
    const buf = Buffer.from(ab);
    const expected = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x10]);
    assert.equal(buf.length, expected.length, "arrayBuffer() must return exactly the bytes sent (length mismatch)");
    for (let i = 0; i < expected.length; i++) {
      assert.equal(buf[i], expected[i], `arrayBuffer() byte ${i} must match exactly (got 0x${buf[i]?.toString(16)}, expected 0x${expected[i].toString(16)})`);
    }

    // --- 3. headers.get(): case-insensitive lookup, null for absent header ---
    const pdfRes = await withTimeout(fetch(`${base}/pdf-type`), TEST_TIMEOUT_MS, "pdf-type request");
    assert.equal(pdfRes.headers.get("content-type"), "application/pdf", "headers.get('content-type') must return the Content-Type header value");
    assert.equal(pdfRes.headers.get("Content-Type"), "application/pdf", "headers.get() must be case-insensitive");
    assert.equal(pdfRes.headers.get("x-absent"), null, "headers.get() must return null for a header that was not sent");

    // --- 4. ok semantics: 200 -> ok true, 404 -> ok false + status 404 ---
    const okRes = await withTimeout(fetch(`${base}/ok`), TEST_TIMEOUT_MS, "200 request");
    assert.equal(okRes.ok, true, "a 200 response must have ok === true");
    assert.equal(okRes.status, 200, "a 200 response must have status === 200");

    const notFoundRes = await withTimeout(fetch(`${base}/missing`), TEST_TIMEOUT_MS, "404 request");
    assert.equal(notFoundRes.ok, false, "a 404 response must have ok === false");
    assert.equal(notFoundRes.status, 404, "a 404 response must have status === 404");

    // --- 5. redirect following: 302 + relative Location resolved and followed ---
    const redirectRes = await withTimeout(fetch(`${base}/redirect`), TEST_TIMEOUT_MS, "redirect request");
    const redirectBody = await redirectRes.text();
    assert.equal(redirectBody, "ARRIVED", "fetch must follow a 302 + relative Location to the final resource body");
    assert.equal(redirectRes.ok, true, "the followed response (final 200) must have ok === true");

    // --- 6. redirect bound: a redirect loop must terminate, not hang ---
    const loopRes = await withTimeout(fetch(`${base}/loop`), TEST_TIMEOUT_MS, "redirect loop request");
    assert.equal(loopRes.ok, false, "after exhausting MAX_REDIRECTS, the last 3xx response must be returned as ok === false, not thrown or hung");
    assert.equal(loopRes.status, 302, "the returned non-ok response after redirect exhaustion should carry the last 3xx status");

    console.log("✅ test-fetch-polyfill passed");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
})().catch((e) => { console.error(e); process.exit(1); });
