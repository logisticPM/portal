// Read-only: does each allow-listed open host accept our truthful user-agent?
//
// Switching off the browser disguise could break a harvest whose host really does refuse a
// non-browser UA. This answers that BEFORE any batch runs, one HEAD-like GET per host, and
// reports rather than adapts — a host that refuses is a finding, not a reason to disguise.
import "./fetch-polyfill";
import { OPEN_HOSTS } from "../src/lib/cases/ingest/official-source";
import { CRAWLER_UA } from "../src/lib/cases/ingest/crawler-id";

async function probe(url: string): Promise<string> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": CRAWLER_UA } });
    return `${res.status} ${res.headers.get("content-type") ?? ""}`;
  } catch (e) {
    return `ERROR ${(e as Error).message}`;
  }
}

async function main() {
  console.log(`UA: ${CRAWLER_UA}\n`);
  let refused = 0;
  for (const host of OPEN_HOSTS) {
    const r = await probe(`https://${host}/robots.txt`);
    const bad = /^(401|403|429)/.test(r);
    if (bad) refused++;
    console.log(`  ${bad ? "✗" : "✓"} ${host.padEnd(34)} robots.txt → ${r}`);
    await new Promise((s) => setTimeout(s, 2000));
  }
  console.log(refused === 0
    ? `\n✅ all ${OPEN_HOSTS.length} hosts accept the truthful UA`
    : `\n⚠ ${refused} host(s) refused it — report this, do NOT reinstate a browser UA`);
}
main().catch((e) => { console.error("❌ cases-probe-hosts failed:", e); process.exit(1); });
