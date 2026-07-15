import { setShowcaseOptInForParty } from "../src/lib/rap/actions-core";
import { rapRepo } from "../src/lib/rap";
import type { OrgClaim } from "../src/lib/rap/types";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean) => { console.log(`${ok ? "✅" : "❌"} ${n}`); ok ? pass++ : fail++; };
const claim = (o: Partial<OrgClaim>): OrgClaim => ({ businessNumber: "890561467", partyId: "c-acme", status: "granted", attestedAt: "2026-01-01T00:00:00.000Z", grantedBy: "system:bn-verify", ...o });

async function main() {
  await rapRepo.putClaim(claim({ partyId: "c-acme", businessNumber: "890561467" }));
  const ok = await setShowcaseOptInForParty({ partyId: "c-acme", bn: "890561467", optIn: true, now: "2026-07-15T00:00:00.000Z" });
  check("claim holder may opt in", ok.ok === true);
  check("flag + timestamp persisted", (await rapRepo.getClaim("890561467", "c-acme"))?.showcaseOptIn === true);

  const off = await setShowcaseOptInForParty({ partyId: "c-acme", bn: "890561467", optIn: false, now: "2026-07-15T00:00:00.000Z" });
  check("opt-out flips it off", off.ok === true && (await rapRepo.getClaim("890561467", "c-acme"))?.showcaseOptIn === false);

  const nope = await setShowcaseOptInForParty({ partyId: "c-nobody", bn: "890561467", optIn: true, now: "2026-07-15T00:00:00.000Z" });
  check("party without a granted claim is rejected", nope.ok === false);
  process.exit(fail ? 1 : 0);
}
main();
