// Read-only audit: for every stored case whose sourceUrl is an open host, report whether that
// URL is now robots-disallowed (per the real robots.txt). Surfaces the blast radius of the
// historical bccourts /jdb-txt/ violation. NEVER writes to Dynamo.
import "./fetch-polyfill";
import { dynamoCaseRepo } from "../src/lib/cases/repo.dynamo";
import { isOpenSource, toDocumentUrl } from "../src/lib/cases/ingest/official-source";
import { makeRobotsGate } from "../src/lib/cases/ingest/robots";

type HostRec = { total: number; disallowed: number; disallowedWithText: number; samples: string[] };
const hostOf = (u: string) => { try { return new URL(u).host; } catch { return "?"; } };

async function main() {
  const all = await dynamoCaseRepo.listCases({ tier: "all" });
  const open = all.filter((c) => isOpenSource(c.provenance.sourceUrl));
  const gate = makeRobotsGate(); // shared → each host's robots.txt fetched once
  const perHost = new Map<string, HostRec>();
  let totalDisallowed = 0, disallowedWithText = 0;

  for (const c of open) {
    const host = hostOf(c.provenance.sourceUrl);
    const rec = perHost.get(host) ?? { total: 0, disallowed: 0, disallowedWithText: 0, samples: [] };
    rec.total++;
    const allowed = await gate.allows(toDocumentUrl(c.provenance.sourceUrl));
    if (!allowed) {
      rec.disallowed++; totalDisallowed++;
      if (c.fullTextAvailable) { rec.disallowedWithText++; disallowedWithText++; }
      if (rec.samples.length < 5) rec.samples.push(c.id);
    }
    perHost.set(host, rec);
  }

  console.log(`robots audit: ${open.length} open-source cases · ${totalDisallowed} robots-DISALLOWED (${disallowedWithText} already have full text)`);
  for (const [host, r] of [...perHost.entries()].sort((a, b) => b[1].disallowed - a[1].disallowed)) {
    console.log(`  ${host}: ${r.disallowed}/${r.total} disallowed · ${r.disallowedWithText} with full text · e.g. ${r.samples.join(", ") || "—"}`);
  }
}

main().catch((e) => { console.error("❌ cases-audit-robots failed:", e); process.exit(1); });
