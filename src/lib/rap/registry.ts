// Business-registry lookups behind a provider seam. v1: verify-by-BN only
// (free ISED Federal Corp API); fuzzy searchByName is the pluggable v2 hook.
export interface RegistryEntity {
  businessNumber: string; // 9-digit root
  legalName: string;
  status: string;
  jurisdiction: string;
  officeLocation: string | null;
  source: "ised";
}
export interface RegistryProvider {
  verifyBN(bn9: string): Promise<RegistryEntity | null>;
  searchByName?(query: string): Promise<RegistryEntity[]>;
}

export class StubRegistryProvider implements RegistryProvider {
  constructor(private readonly canned: Record<string, RegistryEntity> = {}) {}
  async verifyBN(bn9: string) { return this.canned[bn9] ?? null; }
}

// Prefilled deep-link to Canada's Business Registries (web-only; no API).
// TODO(activation): confirm the `search` query param against the live CBR
// site (ised-isde.canada.ca/cbr-rec/) -- bounded Task 9 research could not
// verify it (the search form's client-side behaviour wasn't inspectable via
// fetch), so this is left as our original assumption, unconfirmed.
export function cbrSearchUrl(name: string): string {
  return `https://ised-isde.canada.ca/cbr-rec/?search=${encodeURIComponent(name)}`;
}

// --- ISED Federal Corporation API provider (Task 9) ---------------------
//
// Bounded contract research (2026-07-10, via api.ised-isde.canada.ca docs +
// its linked OpenAPI spec at /swagger/spec/corporations-en.json): the API is
// keyed by corporation-number or 9-digit BN (not name), covers federal
// corporations only, and the "public" plan is free at ~60 req/min. The exact
// endpoint path and JSON field names below are our best reading of that spec,
// NOT a captured live response -- each is flagged for confirmation when the
// team activates real registry lookups.

// TODO(activation): confirm against live ISED API. Spec page documents
// `GET /v1/corporations/{corporation_bn9}.json` (and a parallel
// `{corporation_id}.json` form); confirm this is reachable without an API
// key on the public plan, and whether `lang` needs to be passed.
const ISED_FEDERAL_CORP_BASE_URL =
  "https://api.ised-isde.canada.ca/v1/corporations";

function isedCorpUrl(bn9: string): string {
  return `${ISED_FEDERAL_CORP_BASE_URL}/${bn9}.json`;
}

// TODO(activation): confirm against live ISED API. Documented public-plan
// rate limit; not yet load-tested against the real service.
const ISED_PUBLIC_PLAN_RATE_LIMIT_PER_MINUTE = 60;

// TODO(activation): confirm against live ISED API. Assumed response shape
// (from the OpenAPI spec summary): `corporationNames[]` with a `current`
// boolean flag, `status`, `addresses[]` with `city`/`provinceCode`, and
// `businessNumbers.businessNumber`. The spec also notes an unknown
// corporation number can come back as HTTP 200 with an `errors[]` array
// instead of a 404 -- both are treated as "not found" below.
function mapIsedResponseToEntity(
  body: unknown,
  bn9: string,
): RegistryEntity | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;

  if (Array.isArray(record.errors) && record.errors.length > 0) return null;

  const names = record.corporationNames;
  const currentName = Array.isArray(names)
    ? (names.find((n: any) => n?.current)?.name ?? names[0]?.name)
    : undefined;
  if (!currentName) return null;

  const addresses = record.addresses ?? (record as any).adresses; // TODO(activation): confirm key spelling
  const office =
    Array.isArray(addresses) && addresses.length > 0
      ? [addresses[0]?.city, addresses[0]?.provinceCode]
          .filter(Boolean)
          .join(", ") || null
      : null;

  return {
    businessNumber: bn9,
    legalName: currentName,
    status: typeof record.status === "string" ? record.status : "Unknown",
    jurisdiction: "CA-federal",
    officeLocation: office,
    source: "ised",
  };
}

export class IsedFederalCorpProvider implements RegistryProvider {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async verifyBN(bn9: string): Promise<RegistryEntity | null> {
    const res = await this.fetchImpl(isedCorpUrl(bn9), { method: "GET" });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const body = await res.json();
    return mapIsedResponseToEntity(body, bn9);
  }
}

// ISED provider is opt-in until real registry lookups are activated by the
// team; default stays the stub so existing callers are unaffected.
export function getRegistryProvider(): RegistryProvider {
  if (process.env.REGISTRY_IMPL === "ised") {
    return new IsedFederalCorpProvider();
  }
  return new StubRegistryProvider();
}
