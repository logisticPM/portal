// scripts/test-rap-registry-ised.ts
import assert from "node:assert/strict";
import { IsedFederalCorpProvider } from "../src/lib/rap/registry";

// Synthetic payload matching our assumed ISED Federal Corporation API v1 shape
// (see TODO(activation) comments in src/lib/rap/registry.ts). Not a captured
// live response — this test only guards our injected-fetch contract + mapping.
const SAMPLE_HIT_PAYLOAD = {
  corporationId: 12345,
  corporationNames: [
    { name: "ENBRIDGE INC.", current: true, effectiveDate: "1998-06-01" },
    { name: "OLD NAME LTD.", current: false, effectiveDate: "1970-01-01" },
  ],
  status: "Active",
  act: "CBCA",
  addresses: [
    { addressLine: ["200 3RD AVE SW"], city: "CALGARY", postalCode: "T2P 4H2", provinceCode: "AB", countryCode: "CA" },
  ],
  businessNumbers: { businessNumber: "119653384" },
};

function fakeFetch(payload: unknown, status: number): typeof fetch {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
    } as Response;
  }) as typeof fetch;
  (impl as any).calls = calls;
  return impl;
}

async function main() {
  // 1) request shape: URL contains the bn9, method is GET
  const hitFetch = fakeFetch(SAMPLE_HIT_PAYLOAD, 200);
  const providerHit = new IsedFederalCorpProvider(hitFetch);
  const entity = await providerHit.verifyBN("119653384");
  const calls = (hitFetch as any).calls as { url: string; init?: RequestInit }[];
  assert.equal(calls.length, 1, "exactly one fetch call");
  assert.ok(calls[0].url.includes("119653384"), "request URL contains the bn9");
  assert.equal(calls[0].init?.method ?? "GET", "GET", "request method is GET");

  // 2) mapping yields the right RegistryEntity
  assert.deepEqual(entity, {
    businessNumber: "119653384",
    legalName: "ENBRIDGE INC.",
    status: "Active",
    jurisdiction: "CA-federal",
    officeLocation: "CALGARY, AB",
    source: "ised",
  });

  // 3) 404-style stub response -> null
  const missFetch404 = fakeFetch(null, 404);
  const providerMiss = new IsedFederalCorpProvider(missFetch404);
  assert.equal(await providerMiss.verifyBN("000000000"), null, "404 -> null");

  // 3b) ISED is documented to sometimes return HTTP 200 with an empty/error body
  // for an unknown corporation rather than a 404 -- guard that case too.
  const missFetch200Empty = fakeFetch({ errors: [{ message: "not found" }] }, 200);
  const providerMissEmpty = new IsedFederalCorpProvider(missFetch200Empty);
  assert.equal(await providerMissEmpty.verifyBN("000000001"), null, "200 w/ errors[] -> null");

  console.log("OK test-rap-registry-ised");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
