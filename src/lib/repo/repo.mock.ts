import type {
  PortalRepo,
  Party,
  Supplier,
  ReportedLine,
  Confirmation,
  FlowType,
  FlowTag,
  IdentityTier,
  SupplierShowcase,
} from "./types";

// ===========================================================================
// DEV MOCK — in-memory implementation of PortalRepo.
//
// Owned long-term by the DATA group (Sunny/Sharon refine it + add repo.dynamo.ts).
// Created here so the Q+C group (Nate / Jack) can build against the interface NOW.
// State lives in module scope: it persists within a running dev server, resets on restart.
// ===========================================================================

const FLOWS: FlowType[] = ["procurement", "capital"];
const TIERS: IdentityTier[] = ["nation", "ccab", "self_declared"];

function emptyFlowMap() {
  return FLOWS.reduce(
    (acc, f) => {
      acc[f] = { reported: 0, confirmed: 0 };
      return acc;
    },
    {} as Record<FlowType, { reported: number; confirmed: number }>,
  );
}

const now = () => new Date().toISOString();

// --- seed data (synthetic, fictional) -------------------------------------
const parties: Party[] = [
  { id: "c-northway", role: "company", name: "Northway Energy", registered: true, createdAt: now() },
  { id: "c-cedartrust", role: "company", name: "Cedar Trust Bank", registered: true, createdAt: now() },
  { id: "c-mapletel", role: "company", name: "Maple Telecom", registered: true, createdAt: now() },
  { id: "s-eagle", role: "supplier", name: "Eagle River Construction", identityTier: "nation", ownershipPct: 100, sector: "Construction", region: "BC", blurb: "Heavy civil & site construction for energy and public works.", profilePublic: true, registered: true, createdAt: now() },
  { id: "s-raven", role: "supplier", name: "Raven Logistics", identityTier: "ccab", ownershipPct: 80, sector: "Logistics", region: "AB", blurb: "Freight, warehousing and last-mile across the prairies.", profilePublic: true, registered: true, createdAt: now() },
  { id: "s-thunderbird", role: "supplier", name: "Thunderbird IT Services", identityTier: "ccab", ownershipPct: 75, registered: true, createdAt: now() },
  { id: "s-sweetgrass", role: "supplier", name: "Sweetgrass Catering", identityTier: "self_declared", ownershipPct: 35, sector: "Catering", region: "SK", blurb: "Event and corporate catering.", profilePublic: true, registered: true, createdAt: now() },
  { id: "s-cedarsage", role: "supplier", name: "Cedar & Sage Consulting", identityTier: "nation", ownershipPct: 100, registered: true, createdAt: now() },
  { id: "s-salish", role: "supplier", name: "Salish Office Supplies", identityTier: "self_declared", ownershipPct: 30, registered: true, createdAt: now() },
];

let lineSeq = 0;
const L = (
  companyId: string,
  supplierId: string,
  amount: number,
  status: ReportedLine["status"],
  extra: { flowType?: FlowType; tags?: FlowTag[] } = {},
): ReportedLine => ({
  id: `l-${++lineSeq}`,
  companyId,
  supplierId,
  amount,
  flowType: extra.flowType ?? "procurement",
  tags: extra.tags,
  period: "2025",
  reportedAt: now(),
  status,
});

const lines: ReportedLine[] = [
  L("c-northway", "s-eagle", 1_200_000, "confirmed"),
  L("c-northway", "s-raven", 450_000, "confirmed"),
  L("c-northway", "s-sweetgrass", 80_000, "pending"),
  L("c-northway", "s-thunderbird", 300_000, "disputed"),
  L("c-cedartrust", "s-cedarsage", 620_000, "confirmed", { flowType: "capital" }), // equity invested INTO an Indigenous business
  L("c-cedartrust", "s-raven", 150_000, "pending"),
  L("c-cedartrust", "s-salish", 40_000, "confirmed"),
  L("c-mapletel", "s-thunderbird", 900_000, "confirmed", { tags: ["innovation"] }), // R&D-tagged procurement
  L("c-mapletel", "s-eagle", 200_000, "pending"),
  L("c-mapletel", "s-sweetgrass", 25_000, "disputed"),
  L("c-mapletel", "s-cedarsage", 175_000, "confirmed"),
];

// seed a confirmation for every non-pending line
const confirmations: Confirmation[] = lines
  .filter((l) => l.status !== "pending")
  .map((l) => ({
    lineId: l.id,
    status: l.status as Confirmation["status"],
    byPartyId: l.supplierId,
    respondedAt: now(),
  }));

// --- helpers ---------------------------------------------------------------
function activeConfirmation(lineId: string): Confirmation | undefined {
  return confirmations.find((c) => c.lineId === lineId && !c.withdrawn);
}

// Coverage counting rule (spec §6): confirmed at reported amount; corrected at corrected amount;
// pending / disputed / withdrawn contribute 0.
function confirmedAmount(line: ReportedLine): number {
  if (line.withdrawn) return 0;
  if (line.status === "confirmed") return line.amount;
  if (line.status === "corrected") {
    return activeConfirmation(line.id)?.correctedAmount ?? line.amount;
  }
  return 0;
}

function tierOf(supplierId: string): IdentityTier {
  const p = parties.find((x) => x.id === supplierId);
  return p && p.role === "supplier" ? p.identityTier : "self_declared";
}

// --- repo ------------------------------------------------------------------
export const mockRepo: PortalRepo = {
  async getParty(id) {
    return parties.find((p) => p.id === id) ?? null;
  },

  async listParties(role) {
    return parties.filter((p) => (role ? p.role === role : true));
  },

  async registerSupplier(input) {
    const party: Supplier = {
      id: `s-${input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`,
      role: "supplier",
      name: input.name,
      identityTier: input.identityTier,
      registered: true,
      createdAt: now(),
    };
    parties.push(party);
    return party;
  },

  async createReportedLine(input) {
    const line: ReportedLine = {
      id: `l-${++lineSeq}`,
      ...input,
      reportedAt: now(),
      status: "pending",
    };
    lines.push(line);
    return line;
  },

  async listLinesForCompany(companyId) {
    return lines.filter((l) => l.companyId === companyId && !l.withdrawn);
  },

  async listPendingForSupplier(supplierId) {
    return lines.filter(
      (l) => l.supplierId === supplierId && l.status === "pending" && !l.withdrawn,
    );
  },

  async recordConfirmation(input) {
    const line = lines.find((l) => l.id === input.lineId);
    if (!line) throw new Error(`line not found: ${input.lineId}`);
    line.status = input.status;
    // retire any prior active confirmation for this line
    const prior = activeConfirmation(input.lineId);
    if (prior) prior.withdrawn = true;
    const conf: Confirmation = {
      lineId: input.lineId,
      status: input.status,
      correctedAmount: input.correctedAmount,
      byPartyId: input.byPartyId,
      respondedAt: now(),
    };
    confirmations.push(conf);
    return conf;
  },

  async getSupplierRecord(supplierId) {
    const mine = lines.filter((l) => l.supplierId === supplierId && !l.withdrawn);
    return {
      supplierId,
      confirmedRevenue: mine.reduce((s, l) => s + confirmedAmount(l), 0),
      pendingCount: mine.filter((l) => l.status === "pending").length,
      disputedCount: mine.filter((l) => l.status === "disputed").length,
      lines: mine,
    };
  },

  async getSupplierShowcase(supplierId) {
    const p = parties.find((x) => x.id === supplierId);
    if (!p || p.role !== "supplier" || p.profilePublic !== true) return null;
    const mine = lines.filter((l) => l.supplierId === supplierId && !l.withdrawn);
    const byFlow = FLOWS.reduce(
      (acc, f) => { acc[f] = { confirmed: 0 }; return acc; },
      {} as Record<FlowType, { confirmed: number }>,
    );
    const buyers = new Set<string>();
    const tagSet = new Set<string>();
    let confirmedRevenue = 0;
    let asOf = "";
    for (const l of mine) {
      const c = confirmedAmount(l);
      if (c > 0) {
        byFlow[l.flowType].confirmed += c;
        confirmedRevenue += c;
        buyers.add(l.companyId);
        for (const t of l.tags ?? []) tagSet.add(t);
        if (l.period > asOf) asOf = l.period;
      }
    }
    return {
      supplierId, name: p.name, identityTier: p.identityTier, ownershipPct: p.ownershipPct,
      sector: p.sector, blurb: p.blurb, region: p.region, website: p.website,
      confirmedRevenue, byFlow, confirmedBuyerCount: buyers.size, tags: [...tagSet], asOf,
    };
  },

  async updateSupplierProfile(supplierId, input) {
    const p = parties.find((x) => x.id === supplierId);
    if (!p || p.role !== "supplier") throw new Error(`supplier not found: ${supplierId}`);
    if (input.sector !== undefined) p.sector = input.sector || undefined;
    if (input.blurb !== undefined) p.blurb = input.blurb || undefined;
    if (input.region !== undefined) p.region = input.region || undefined;
    if (input.website !== undefined) p.website = input.website || undefined;
    if (input.profilePublic !== undefined) p.profilePublic = input.profilePublic;
    return p;
  },

  async getCoverage(companyId) {
    const mine = lines.filter((l) => l.companyId === companyId && !l.withdrawn);
    const byFlow = emptyFlowMap();
    let totalReported = 0;
    let totalConfirmed = 0;
    for (const l of mine) {
      const c = confirmedAmount(l);
      byFlow[l.flowType].reported += l.amount;
      byFlow[l.flowType].confirmed += c;
      totalReported += l.amount;
      totalConfirmed += c;
    }
    return {
      companyId,
      byFlow,
      totalReported,
      totalConfirmed,
      confirmedPct: totalReported ? Math.round((totalConfirmed / totalReported) * 100) : 0,
    };
  },

  async getIndexSummary() {
    const active = lines.filter((l) => !l.withdrawn);
    const byFlow = emptyFlowMap();
    const byTier = TIERS.reduce(
      (acc, t) => {
        acc[t] = { confirmed: 0 };
        return acc;
      },
      {} as Record<IdentityTier, { confirmed: number }>,
    );
    const byTag: Record<string, { confirmed: number }> = {};
    let totalReported = 0;
    let totalConfirmed = 0;
    for (const l of active) {
      const c = confirmedAmount(l);
      byFlow[l.flowType].reported += l.amount;
      byFlow[l.flowType].confirmed += c;
      byTier[tierOf(l.supplierId)].confirmed += c;
      for (const t of l.tags ?? []) (byTag[t] ??= { confirmed: 0 }).confirmed += c;
      totalReported += l.amount;
      totalConfirmed += c;
    }
    return {
      totalReported,
      totalConfirmed,
      confirmedPct: totalReported ? Math.round((totalConfirmed / totalReported) * 100) : 0,
      byFlow,
      byTier,
      byTag,
      companyCount: parties.filter((p) => p.role === "company").length,
      supplierCount: parties.filter((p) => p.role === "supplier").length,
      disputedCount: active.filter((l) => l.status === "disputed").length,
    };
  },

  async exportRecords(partyId) {
    const party = parties.find((p) => p.id === partyId);
    if (!party) throw new Error(`party not found: ${partyId}`);
    const isSupplier = party.role === "supplier";
    const myLines = lines.filter((l) =>
      isSupplier ? l.supplierId === partyId : l.companyId === partyId,
    );
    const myConfs = confirmations.filter((c) =>
      isSupplier ? c.byPartyId === partyId : myLines.some((l) => l.id === c.lineId),
    );
    return { party, lines: myLines, confirmations: myConfs };
  },

  async withdraw(partyId) {
    // OCAP: a supplier withdraws their confirmations → those lines revert to 'pending'.
    // The company's reported claim REMAINS (never hard-deleted).
    for (const c of confirmations) {
      if (c.byPartyId === partyId && !c.withdrawn) {
        c.withdrawn = true;
        const line = lines.find((l) => l.id === c.lineId);
        if (line) line.status = "pending";
      }
    }
  },
};
