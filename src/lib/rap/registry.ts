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

// Prefilled deep-link to Canada's Business Registries (web-only; no API). The
// exact query param is confirmed against the live site during Task 9.
export function cbrSearchUrl(name: string): string {
  return `https://ised-isde.canada.ca/cbr-rec/?search=${encodeURIComponent(name)}`;
}

// ISED provider is added in Task 9; selected here so callers never branch.
export function getRegistryProvider(): RegistryProvider {
  return new StubRegistryProvider();
}
