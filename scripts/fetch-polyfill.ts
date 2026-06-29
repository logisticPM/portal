// Polyfill global.fetch with node:https on platforms where undici's built-in
// fetch times out (e.g. Windows with certain TLS stacks). Imported as a side
// effect at the top of ingest scripts before any live-network modules load.
import https from "node:https";
import http from "node:http";

type FetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
};

function nodeFetch(url: string | URL): Promise<FetchResponse> {
  const urlStr = url.toString();
  const lib = urlStr.startsWith("https") ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.get(urlStr, { timeout: 30000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString();
        resolve({
          ok: (res.statusCode ?? 0) < 400,
          status: res.statusCode ?? 0,
          json: () => Promise.resolve(JSON.parse(text)),
          text: () => Promise.resolve(text),
        });
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("request timeout")); });
  });
}

// Only install if the built-in fetch is broken (test with a known URL would be
// slow; instead always install — node:https is stable on all platforms).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).fetch = nodeFetch;
