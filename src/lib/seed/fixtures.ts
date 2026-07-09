// ===========================================================================
// Synthetic dataset (spec §10.2 — Sharon owns this).
//
// No real data yet, so this is fabricated test data. It MIRRORS repo.mock's seed
// on purpose: that makes the mock a "golden reference" you can verify the DynamoDB
// repo against (same inputs → same coverage/record/index numbers). Edit freely —
// add suppliers, change amounts/statuses — to make the coverage view more convincing.
// ===========================================================================
import type { Confirmation, FlowTag, FlowType, Party, ReportedLine, User, Verification } from "../repo/types";

// fixed timestamp so seeding is deterministic (re-running gives identical items)
export const T = "2025-01-15T00:00:00.000Z";

export const parties: Party[] = [
  // companies (buyers being measured — no identity tier)
  { id: "c-northway", role: "company", name: "Northway Energy", registered: true, createdAt: T },
  { id: "c-cedartrust", role: "company", name: "Cedar Trust Bank", registered: true, createdAt: T },
  { id: "c-mapletel", role: "company", name: "Maple Telecom", registered: true, createdAt: T },
  // suppliers (Indigenous parties — each carries a verification tier; Q32 certified-vs-self)
  { id: "s-peacehills", role: "supplier", name: "Peace Hills Trust", identityTier: "nation", ownershipPct: 100, sector: "Finance", sectorNorm: "finance", region: "AB", regionNorm: "AB", website: "https://www.peacehills.com/", blurb: "Canada's oldest and largest First Nations-owned trust company — banking, trust and lending.", profilePublic: true, verifications: [{ source: "nation", reference: "Samson Cree Nation (wholly owned)", status: "verified", verifiedAt: "2025-01-10T00:00:00.000Z", expiresAt: "2028-01-10", verifiedBy: "Samson Cree Nation" }] as Verification[], registered: true, createdAt: T },
  { id: "s-fch", role: "supplier", name: "First Canadian Health", identityTier: "nation", ownershipPct: 100, sector: "Health services", sectorNorm: "health", region: "ON", regionNorm: "ON", website: "https://firstcanadianhealth.biz/", blurb: "Indigenous-owned health-benefits and claims management (Tribal Councils Investment Group of Manitoba).", profilePublic: true, verifications: [{ source: "nation", reference: "Tribal Councils Investment Group of Manitoba", status: "verified", verifiedAt: "2025-01-15T00:00:00.000Z", expiresAt: "2028-01-15", verifiedBy: "Tribal Councils Investment Group of Manitoba" }] as Verification[], registered: true, createdAt: T },
  { id: "s-bouchier", role: "supplier", name: "The Bouchier Group", identityTier: "ccib", ownershipPct: 100, sector: "Logistics & site services", sectorNorm: "transport", region: "AB", regionNorm: "AB", website: "https://bouchier.ca/", blurb: "Indigenous-owned logistics, civil contracting and facility services in the Athabasca oil sands.", profilePublic: true, verifications: [{ source: "ccib", reference: "CCIB Certified (PAR Gold)", status: "verified", verifiedAt: "2025-02-01T00:00:00.000Z", expiresAt: "2028-02-01", verifiedBy: "CCIB" }] as Verification[], registered: true, createdAt: T },
  { id: "s-desnedhe", role: "supplier", name: "Des Nedhe Development", identityTier: "nation", ownershipPct: 100, sector: "Mining & construction", sectorNorm: "mining", region: "SK", regionNorm: "SK", website: "https://desnedhe.com/", blurb: "English River First Nation's development company — mining services, construction and professional services.", profilePublic: true, verifications: [{ source: "nation", reference: "English River First Nation (wholly owned)", status: "verified", verifiedAt: "2025-01-20T00:00:00.000Z", expiresAt: "2028-01-20", verifiedBy: "English River First Nation" }] as Verification[], registered: true, createdAt: T },
  { id: "s-kitsaki", role: "supplier", name: "Kitsaki Management LP", identityTier: "nation", ownershipPct: 100, sector: "Forestry & diversified", sectorNorm: "forestry", region: "SK", regionNorm: "SK", website: "https://kitsaki.com/", blurb: "Lac La Ronge Indian Band's diversified enterprise — forestry, transport, mining and engineering.", profilePublic: true, verifications: [{ source: "nation", reference: "Lac La Ronge Indian Band", status: "verified", verifiedAt: "2025-01-18T00:00:00.000Z", expiresAt: "2028-01-18", verifiedBy: "Lac La Ronge Indian Band" }] as Verification[], registered: true, createdAt: T },
  { id: "s-norsask", role: "supplier", name: "NorSask Forest Products", identityTier: "nation", ownershipPct: 100, sector: "Forestry", sectorNorm: "forestry", region: "SK", regionNorm: "SK", website: "https://norsask.ca/", blurb: "Canada's largest First Nations-owned sawmill (Meadow Lake Tribal Council).", profilePublic: true, verifications: [{ source: "nation", reference: "Meadow Lake Tribal Council (wholly owned)", status: "verified", verifiedAt: "2025-01-12T00:00:00.000Z", expiresAt: "2028-01-12", verifiedBy: "Meadow Lake Tribal Council" }] as Verification[], registered: true, createdAt: T },
  { id: "s-animikii", role: "supplier", name: "Animikii", identityTier: "ccib", ownershipPct: 100, sector: "Technology & software", sectorNorm: "technology", region: "BC", regionNorm: "BC", website: "https://animikii.com/", blurb: "100% Indigenous-owned technology and software agency (Certified B Corporation).", profilePublic: true, verifications: [{ source: "ccib", reference: "CCIB Certified Indigenous Business", status: "verified", verifiedAt: "2025-02-05T00:00:00.000Z", expiresAt: "2028-02-05", verifiedBy: "CCIB" }] as Verification[], registered: true, createdAt: T },
  { id: "s-ntg", role: "supplier", name: "Nations Translation Group", identityTier: "ccib", ownershipPct: 51, sector: "Language & professional services", sectorNorm: "professional_services", region: "ON", regionNorm: "ON", website: "https://www.nationstranslation.com/", blurb: "Canada's largest Indigenous-owned language-services provider (100+ languages).", profilePublic: true, verifications: [{ source: "ccib", reference: "CCIB Certified Indigenous Business", status: "verified", verifiedAt: "2025-02-10T00:00:00.000Z", expiresAt: "2028-02-10", verifiedBy: "CCIB" }] as Verification[], registered: true, createdAt: T },
  { id: "s-3ne", role: "supplier", name: "Three Nations Energy", identityTier: "nation", ownershipPct: 100, sector: "Energy", sectorNorm: "energy", region: "AB", regionNorm: "AB", website: "https://www.3ne.ca/", blurb: "Indigenous-owned clean energy — operates the Fort Chipewyan solar farm (ACFN, MCFN, Fort Chip Métis).", profilePublic: true, verifications: [{ source: "nation", reference: "ACFN / MCFN / Fort Chipewyan Métis (equal owners)", status: "verified", verifiedAt: "2024-11-01T00:00:00.000Z", expiresAt: "2027-11-01", verifiedBy: "ACFN, MCFN & Fort Chipewyan Métis Nation" }] as Verification[], registered: true, createdAt: T },
  { id: "s-membertou", role: "supplier", name: "Membertou Development Corporation", identityTier: "nation", ownershipPct: 100, sector: "Construction & diversified", sectorNorm: "construction", region: "NS", regionNorm: "NS", website: "https://membertou.ca/", blurb: "Membertou First Nation's business arm — construction, fisheries, hospitality and geomatics.", profilePublic: true, verifications: [{ source: "nation", reference: "Membertou First Nation (wholly owned)", status: "verified", verifiedAt: "2025-01-08T00:00:00.000Z", expiresAt: "2028-01-08", verifiedBy: "Membertou First Nation" }] as Verification[], registered: true, createdAt: T },
];

// every line is a procurement claim (MVP flagship pillar); amount = exact CAD (Q31), period = annual (Q5)
const L = (
  id: string,
  companyId: string,
  supplierId: string,
  amount: number,
  status: ReportedLine["status"],
  extra: { flowType?: FlowType; tags?: FlowTag[] } = {},
): ReportedLine => ({
  id,
  companyId,
  supplierId,
  amount,
  flowType: extra.flowType ?? "procurement",
  tags: extra.tags,
  period: "2025",
  reportedAt: T,
  status,
});

export const lines: ReportedLine[] = [
  L("l-1", "c-northway", "s-membertou", 1_200_000, "confirmed"),
  L("l-2", "c-northway", "s-bouchier", 450_000, "confirmed"),
  L("l-3", "c-northway", "s-fch", 80_000, "pending"),
  L("l-4", "c-northway", "s-animikii", 300_000, "disputed"),
  L("l-5", "c-cedartrust", "s-ntg", 620_000, "confirmed", { flowType: "capital" }), // equity invested INTO an Indigenous business
  L("l-6", "c-cedartrust", "s-bouchier", 150_000, "pending"),
  L("l-7", "c-cedartrust", "s-peacehills", 40_000, "confirmed"),
  L("l-8", "c-mapletel", "s-animikii", 900_000, "confirmed", { tags: ["innovation"] }), // R&D-tagged procurement
  L("l-9", "c-mapletel", "s-membertou", 200_000, "pending"),
  L("l-10", "c-mapletel", "s-fch", 25_000, "disputed"),
  L("l-11", "c-mapletel", "s-ntg", 175_000, "confirmed"),
];

// one confirmation per non-pending line (the supplier named on it responded)
export const confirmations: Confirmation[] = lines
  .filter((l) => l.status !== "pending")
  .map((l) => ({
    lineId: l.id,
    status: l.status as Confirmation["status"],
    byPartyId: l.supplierId,
    respondedAt: T,
  }));

// --- demo auth accounts (synthetic-data only — see design §10) ---
// Shared, obviously-fake password so the team can sign in as any seeded entity
// at the showcase. NEVER seed these against a real-data environment.
export const DEMO_PASSWORD = "demo-portal-2026";

export const demoUsers: { email: string; kind: "company" | "supplier" | "indigenomics"; partyId?: string }[] = [
  ...parties.map((p) => ({
    email: `${p.id.replace(/^[cs]-/, "")}@demo`, // c-northway → northway@demo
    kind: p.role,
    partyId: p.id,
  })),
  { email: "institute@demo", kind: "indigenomics" as const },
];
