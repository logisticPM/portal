// ===========================================================================
// SINGLE-TABLE DESIGN — the data group's internal contract (spec §10.2).
//
// One physical table, `DataPortal`, holds every entity (Party / ReportedLine /
// Confirmation). The access-pattern list (spec Appendix A) drives the keys:
//
//   AP2  list a company's lines             → main:  PK=COMPANY#<id>   SK begins_with LINE#
//   AP3  list a supplier's PENDING lines      → GSI1:  GSI1PK=SUPPLIER#<id> SK begins_with STATUS#pending#
//   AP5b a supplier's whole record (all lines) → GSI1:  GSI1PK=SUPPLIER#<id> (any status)
//   AP6  get a party profile + tier            → main:  PK=PARTY#<id>     SK=PROFILE
//   AP7  list parties by role (picker)         → GSI2:  GSI2PK=ROLE#<role>
//   AP8  withdraw (find a supplier's confs)     → GSI1:  GSI1PK=SUPPLIER#<id> (et=Conf)
//   AP9  export a party's items                 → main (company) / GSI1 (supplier)
//
// "Australia for mechanics" (spec §6.1) — the survey fields map onto these items:
//   • RAP Impact Survey Q31 (exact procurement $)   → ReportedLine.amount
//   • Q5  (annual reporting cadence)                → ReportedLine.period
//   • Q32 (Supply-Nation-certified vs self-declared) → Supplier.identityTier on the PARTY item
//   • Q30 ($ buckets) / Q33 (# of businesses)        → DERIVED at read time, not stored
//   The survey's org-level questions (employee counts, ASX200, events attended)
//   are NOT modelled — they don't fit the itemized report→confirm loop.
//
// Both Local and cloud use this exact file. Sunny (writes) populates these keys;
// Sharon (reads) queries them. Co-own this file the way the whole team co-owns types.ts.
// ===========================================================================
import type {
  Company,
  Confirmation,
  ConfirmationStatus,
  Party,
  PartyRole,
  ReportedLine,
  Supplier,
} from "../repo/types";

// --- index names (used by repo.dynamo queries + the create-table script) ----
export const GSI1 = "GSI1"; // supplier-centric reads (pending inbox, my-record, export, withdraw)
export const GSI2 = "GSI2"; // role-centric reads (party picker / role-switcher)

// --- entity-type discriminator (a GSI1 query returns Lines AND Confs; filter on this) ---
export type EntityType = "Party" | "Line" | "Conf";

// --- key builders (the single source of truth for how keys are shaped) -------
export const keys = {
  party: (id: string) => ({ PK: `PARTY#${id}`, SK: "PROFILE" }),
  line: (companyId: string, lineId: string) => ({
    PK: `COMPANY#${companyId}`,
    SK: `LINE#${lineId}`,
  }),
  // a line's GSI1 sort key encodes status, so the pending inbox is a begins_with query.
  // NOTE for writers: when status changes (recordConfirmation / withdraw) you MUST
  // rewrite GSI1SK too, or the pending inbox will read stale.
  lineGsi1Sk: (status: ConfirmationStatus, lineId: string) =>
    `STATUS#${status}#LINE#${lineId}`,
};

// partition-key values for GSI queries (read side)
export const gsi1Supplier = (supplierId: string) => `SUPPLIER#${supplierId}`;
export const gsi2Role = (role: PartyRole) => `ROLE#${role}`;

// begins_with prefixes for range queries
export const prefix = {
  companyLines: "LINE#", // AP2: all of a company's lines
  pendingForSupplier: "STATUS#pending#", // AP3: a supplier's pending inbox
} as const;

// ===========================================================================
// marshalling — domain object → table item
// ===========================================================================
export function toPartyItem(p: Party) {
  return {
    ...keys.party(p.id),
    et: "Party" as EntityType,
    GSI2PK: gsi2Role(p.role),
    GSI2SK: `PARTY#${p.id}`,
    id: p.id,
    role: p.role,
    name: p.name,
    identityTier: p.role === "supplier" ? p.identityTier : undefined,
    ownershipPct: p.role === "supplier" ? p.ownershipPct : undefined,
    sector: p.role === "supplier" ? p.sector : undefined,
    blurb: p.role === "supplier" ? p.blurb : undefined,
    region: p.role === "supplier" ? p.region : undefined,
    website: p.role === "supplier" ? p.website : undefined,
    profilePublic: p.role === "supplier" ? p.profilePublic : undefined,
    registered: p.registered,
    createdAt: p.createdAt,
  };
}

export function toLineItem(l: ReportedLine) {
  return {
    ...keys.line(l.companyId, l.id),
    et: "Line" as EntityType,
    GSI1PK: gsi1Supplier(l.supplierId),
    GSI1SK: keys.lineGsi1Sk(l.status, l.id),
    id: l.id,
    companyId: l.companyId,
    supplierId: l.supplierId,
    amount: l.amount,
    flowType: l.flowType,
    tags: l.tags ?? [],
    period: l.period,
    reportedAt: l.reportedAt,
    status: l.status,
    withdrawn: l.withdrawn ?? false,
  };
}

// A confirmation is stored under its company partition (so company export is one
// query) AND indexed by supplier on GSI1 (so supplier export / withdraw is one query).
// companyId isn't on the Confirmation type, so the writer passes it in (it has the
// line in hand when recording).
export function toConfItem(c: Confirmation, companyId: string) {
  return {
    PK: `COMPANY#${companyId}`,
    SK: `LINE#${c.lineId}#CONF#${c.respondedAt}`,
    et: "Conf" as EntityType,
    GSI1PK: gsi1Supplier(c.byPartyId),
    GSI1SK: `CONF#${c.respondedAt}#LINE#${c.lineId}`,
    lineId: c.lineId,
    companyId,
    status: c.status,
    correctedAmount: c.correctedAmount,
    byPartyId: c.byPartyId,
    respondedAt: c.respondedAt,
    withdrawn: c.withdrawn ?? false,
  };
}

// ===========================================================================
// unmarshalling — table item → domain object (DocumentClient gives plain objects)
// ===========================================================================
/* eslint-disable @typescript-eslint/no-explicit-any */
export function itemToParty(it: any): Party {
  if (it.role === "supplier") {
    return {
      id: it.id,
      role: "supplier",
      name: it.name,
      identityTier: it.identityTier,
      ownershipPct: it.ownershipPct,
      sector: it.sector,
      blurb: it.blurb,
      region: it.region,
      website: it.website,
      profilePublic: it.profilePublic,
      registered: it.registered,
      createdAt: it.createdAt,
    } satisfies Supplier;
  }
  return {
    id: it.id,
    role: "company",
    name: it.name,
    registered: it.registered,
    createdAt: it.createdAt,
  } satisfies Company;
}

export function itemToLine(it: any): ReportedLine {
  return {
    id: it.id,
    companyId: it.companyId,
    supplierId: it.supplierId,
    amount: it.amount,
    flowType: it.flowType,
    tags: it.tags && it.tags.length ? it.tags : undefined,
    period: it.period,
    reportedAt: it.reportedAt,
    status: it.status,
    withdrawn: it.withdrawn || undefined,
  };
}

export function itemToConf(it: any): Confirmation {
  return {
    lineId: it.lineId,
    status: it.status,
    correctedAmount: it.correctedAmount,
    byPartyId: it.byPartyId,
    respondedAt: it.respondedAt,
    withdrawn: it.withdrawn || undefined,
  };
}
