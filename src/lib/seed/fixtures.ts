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
  { id: "s-eagle", role: "supplier", name: "Eagle River Construction", identityTier: "nation", ownershipPct: 100, sector: "Construction", sectorNorm: "construction", region: "BC", regionNorm: "BC", blurb: "Heavy civil & site construction for energy and public works.", profilePublic: true, verifications: [{ source: "nation", reference: "BCR-2024-014", status: "verified", verifiedAt: "2025-01-10T00:00:00.000Z", expiresAt: "2027-01-10", verifiedBy: "Tsleil-Waututh Nation" }] as Verification[], registered: true, createdAt: T },
  { id: "s-raven", role: "supplier", name: "Raven Logistics", identityTier: "ccab", ownershipPct: 80, sector: "Logistics", sectorNorm: "transport", region: "AB", regionNorm: "AB", blurb: "Freight, warehousing and last-mile across the prairies.", profilePublic: true, verifications: [{ source: "ccib", reference: "CIB-08831", status: "verified", verifiedAt: "2025-02-01T00:00:00.000Z", expiresAt: "2027-02-01", verifiedBy: "CCIB" }] as Verification[], registered: true, createdAt: T },
  { id: "s-thunderbird", role: "supplier", name: "Thunderbird IT Services", identityTier: "ccab", ownershipPct: 75, sectorNorm: "consulting", verifications: [{ source: "isc_ibd", reference: "IBD-44120", status: "verified", verifiedAt: "2025-03-01T00:00:00.000Z", verifiedBy: "ISC" }] as Verification[], registered: true, createdAt: T },
  { id: "s-sweetgrass", role: "supplier", name: "Sweetgrass Catering", identityTier: "self_declared", ownershipPct: 35, sector: "Catering", sectorNorm: "retail", region: "SK", regionNorm: "SK", blurb: "Event and corporate catering.", profilePublic: true, verifications: [{ source: "ccib", reference: "CIB-pending", status: "pending" }] as Verification[], registered: true, createdAt: T },
  { id: "s-cedarsage", role: "supplier", name: "Cedar & Sage Consulting", identityTier: "nation", ownershipPct: 100, sectorNorm: "consulting", verifications: [{ source: "nation", reference: "MNBC-2023-77", status: "verified", verifiedAt: "2025-01-05T00:00:00.000Z", verifiedBy: "Métis Nation BC" }] as Verification[], registered: true, createdAt: T },
  { id: "s-salish", role: "supplier", name: "Salish Office Supplies", identityTier: "self_declared", ownershipPct: 30, sectorNorm: "retail", verifications: [] as Verification[], registered: true, createdAt: T },
  { id: "s-kiewitledcor", role: "supplier", name: "Kiewit-Ledcor Indigenous JV", identityTier: "ccab", ownershipPct: 51, sector: "Construction", sectorNorm: "construction", region: "AB", regionNorm: "AB", blurb: "Major-projects civil construction joint venture.", profilePublic: true, verifications: [{ source: "ccib", reference: "CIB-51002", status: "verified", verifiedAt: "2025-01-05T00:00:00.000Z", expiresAt: "2027-01-05", verifiedBy: "CCIB" }] as Verification[], registered: true, createdAt: T },
  { id: "s-profinancial", role: "supplier", name: "Pro-Financial Indigenous Advisory", identityTier: "nation", ownershipPct: 100, sector: "Finance", sectorNorm: "finance", region: "ON", regionNorm: "ON", blurb: "Indigenous-owned financial advisory & capital markets services.", profilePublic: true, verifications: [{ source: "nation", reference: "BCR-2025-101", status: "verified", verifiedAt: "2025-02-01T00:00:00.000Z", expiresAt: "2027-02-01", verifiedBy: "Chippewas of Rama" }] as Verification[], registered: true, createdAt: T },
  { id: "s-threenations", role: "supplier", name: "Three Nations Energy", identityTier: "nation", ownershipPct: 100, sector: "Energy", sectorNorm: "energy", region: "AB", regionNorm: "AB", blurb: "Indigenous-owned solar and grid infrastructure.", profilePublic: true, verifications: [{ source: "nation", reference: "BCR-2024-088", status: "verified", verifiedAt: "2024-11-01T00:00:00.000Z", expiresAt: "2026-11-01", verifiedBy: "Fort Chipewyan" }] as Verification[], registered: true, createdAt: T },
  { id: "s-mikisew", role: "supplier", name: "Mikisew Energy Services", identityTier: "ccab", ownershipPct: 100, sector: "Energy", sectorNorm: "energy", region: "AB", regionNorm: "AB", blurb: "Site services, logistics and industrial support for energy operators.", profilePublic: true, verifications: [{ source: "ccib", reference: "CIB-22119", status: "verified", verifiedAt: "2025-01-10T00:00:00.000Z", expiresAt: "2027-01-10", verifiedBy: "CCIB" }] as Verification[], registered: true, createdAt: T },
  { id: "s-northernrail", role: "supplier", name: "Northern Rail & Transport", identityTier: "ccab", ownershipPct: 60, sector: "Logistics", sectorNorm: "transport", region: "MB", regionNorm: "MB", blurb: "Freight and rail-adjacent logistics across northern Canada.", profilePublic: true, verifications: [{ source: "ccib", reference: "CIB-30455", status: "verified", verifiedAt: "2025-02-15T00:00:00.000Z", expiresAt: "2027-02-15", verifiedBy: "CCIB" }] as Verification[], registered: true, createdAt: T },
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
  L("l-1", "c-northway", "s-eagle", 1_200_000, "confirmed"),
  L("l-2", "c-northway", "s-raven", 450_000, "confirmed"),
  L("l-3", "c-northway", "s-sweetgrass", 80_000, "pending"),
  L("l-4", "c-northway", "s-thunderbird", 300_000, "disputed"),
  L("l-5", "c-cedartrust", "s-cedarsage", 620_000, "confirmed", { flowType: "capital" }), // equity invested INTO an Indigenous business
  L("l-6", "c-cedartrust", "s-raven", 150_000, "pending"),
  L("l-7", "c-cedartrust", "s-salish", 40_000, "confirmed"),
  L("l-8", "c-mapletel", "s-thunderbird", 900_000, "confirmed", { tags: ["innovation"] }), // R&D-tagged procurement
  L("l-9", "c-mapletel", "s-eagle", 200_000, "pending"),
  L("l-10", "c-mapletel", "s-sweetgrass", 25_000, "disputed"),
  L("l-11", "c-mapletel", "s-cedarsage", 175_000, "confirmed"),
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
