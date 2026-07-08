// Faithful global.fetch polyfill over node:https/node:http, for platforms where
// undici's built-in fetch times out (e.g. Windows with certain TLS stacks). Installed
// as a side effect at the top of ingest scripts. Supports the subset of the fetch API
// our code uses: init.headers passthrough (so a User-Agent actually gets sent — some
// official sites 403 UA-less requests), redirect following (node:https does not follow
// automatically), and a Response with ok/status/headers.get()/arrayBuffer()/text()/json().
import https from "node:https";
import http from "node:http";
import { Buffer } from "node:buffer";

type FetchInit = { headers?: Record<string, string> };
type FetchResponse = {
  ok: boolean;
  status: number;
  headers: { get: (name: string) => string | null };
  arrayBuffer: () => Promise<ArrayBuffer>;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
};

const MAX_REDIRECTS = 5;

function nodeFetch(url: string | URL, init?: FetchInit, redirectsLeft = MAX_REDIRECTS): Promise<FetchResponse> {
  const urlStr = url.toString();
  const lib = urlStr.startsWith("https") ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.get(urlStr, { timeout: 30000, headers: init?.headers ?? {} }, (res) => {
      const status = res.statusCode ?? 0;
      const loc = res.headers.location;
      // node:https/http does NOT follow redirects — do it ourselves.
      if (status >= 300 && status < 400 && loc && redirectsLeft > 0) {
        res.resume(); // drain the redirect body
        const next = new URL(loc, urlStr).toString();
        resolve(nodeFetch(next, init, redirectsLeft - 1));
        return;
      }
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks);
        resolve({
          ok: status >= 200 && status < 300,
          status,
          headers: {
            get: (name: string) => {
              const v = res.headers[name.toLowerCase()];
              return v == null ? null : Array.isArray(v) ? v.join(", ") : v;
            },
          },
          arrayBuffer: () => Promise.resolve(
            body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
          ),
          text: () => Promise.resolve(body.toString("utf8")),
          json: () => Promise.resolve(JSON.parse(body.toString("utf8"))),
        });
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("request timeout")); });
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).fetch = (url: string | URL, init?: FetchInit) => nodeFetch(url, init);
