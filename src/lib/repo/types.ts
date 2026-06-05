// ===========================================================================
// THE SEAM — co-owned by both groups (Data Architecture ↔ Questionnaire+Confirmation).
// This is the ONLY file both groups share. See spec §6 / §7.
// Everything below the PortalRepo interface is DynamoDB (data group);
// everything above it (the React pages) is the Q+C group.
// ===========================================================================

// How strongly a supplier's Indigenous status is verified.
// 'self_declared' is the weakest tier — and the one fraud exploits — so it is shown explicitly.
export type IdentityTier = "nation" | "ccab" | "self_declared";

export type PartyRole = "company" | "supplier";

// Company and Supplier are SEPARATE kinds of party, distinguished by `role`.
// A supplier is the Indigenous party — it always carries an identity tier and is OCAP-protected.
// A company is the buyer being measured — it has no identity tier.
interface BaseParty {
  id: string;
  name: string;
  registered: boolean; // false = named by a company but not yet registered (future invite flow)
  createdAt: string; // ISO 8601
}
export interface Company extends BaseParty {
  role: "company";
}
export interface Supplier extends BaseParty {
  role: "supplier";
  identityTier: IdentityTier; // required — how the supplier's Indigenous status is verified
}
export type Party = Company | Supplier;

// The 4 Indigenomics RAP pillars (NOT Australia's Relationships/Respect/Opportunities/Governance).
// These ARE the economic flow categories — a line's pillar tells you what kind of flow it is.
// MVP flagship: 'procurement'. High-value second: 'equity'.
export type Pillar = "equity" | "capital" | "procurement" | "innovation";

export type ConfirmationStatus = "pending" | "confirmed" | "disputed" | "corrected";

// A single itemized claim reported by a company about a named supplier.
export interface ReportedLine {
  id: string;
  companyId: string;
  supplierId: string;
  amount: number; // CAD
  pillar: Pillar;
  period: string; // e.g. "2025"
  reportedAt: string; // ISO 8601
  status: ConfirmationStatus; // denormalized for fast listing; 'pending' until the supplier acts
  withdrawn?: boolean; // OCAP soft-delete marker (never hard-delete)
}

// The named supplier's response to a reported line.
export interface Confirmation {
  lineId: string;
  status: "confirmed" | "disputed" | "corrected";
  correctedAmount?: number; // set when status === 'corrected'
  byPartyId: string; // the supplier
  respondedAt: string; // ISO 8601
  withdrawn?: boolean; // OCAP: supplier may withdraw their confirmation (line reverts to 'pending')
}

// Derived rollup — the company "coverage" / Index view.
// Counting rule: reported = all line amounts; confirmed = confirmed lines at reported amount
// + corrected lines at corrected amount; disputed/pending/withdrawn contribute 0.
export interface Coverage {
  companyId: string;
  byPillar: Record<Pillar, { reported: number; confirmed: number }>;
  totalReported: number;
  totalConfirmed: number;
  confirmedPct: number;
}

// Supplier-side mirror — what a supplier sees about themselves (OCAP Access/Ownership).
export interface SupplierRecord {
  supplierId: string;
  confirmedRevenue: number; // same counting rule as Coverage.confirmed
  pendingCount: number;
  disputedCount: number;
  lines: ReportedLine[]; // all lines naming this supplier, any status
}

// Macro cross-company rollup — the Indigenomics RAP-analysis page (the "Index" at economy level).
export interface IndexSummary {
  totalReported: number;
  totalConfirmed: number;
  confirmedPct: number;
  byPillar: Record<Pillar, { reported: number; confirmed: number }>;
  byTier: Record<IdentityTier, { confirmed: number }>; // confirmed $ by supplier identity tier
  companyCount: number;
  supplierCount: number;
  disputedCount: number;
}

export interface ExportBundle {
  party: Party;
  lines: ReportedLine[];
  confirmations: Confirmation[];
}

export interface PortalRepo {
  // --- parties / registry ---
  getParty(id: string): Promise<Party | null>;
  listParties(role?: PartyRole): Promise<Party[]>;
  registerSupplier(input: { name: string; identityTier: IdentityTier }): Promise<Supplier>; // stretch

  // --- company side ---
  createReportedLine(input: {
    companyId: string;
    supplierId: string;
    amount: number;
    pillar: Pillar;
    period: string;
  }): Promise<ReportedLine>;
  listLinesForCompany(companyId: string): Promise<ReportedLine[]>;

  // --- supplier side ---
  listPendingForSupplier(supplierId: string): Promise<ReportedLine[]>; // the confirm inbox
  recordConfirmation(input: {
    lineId: string;
    status: "confirmed" | "disputed" | "corrected";
    correctedAmount?: number;
    byPartyId: string;
  }): Promise<Confirmation>;
  getSupplierRecord(supplierId: string): Promise<SupplierRecord>; // the "My Record" view

  // --- index / coverage ---
  getCoverage(companyId: string): Promise<Coverage>; // per-company (Nate)
  getIndexSummary(): Promise<IndexSummary>; // macro (Jack — analytics)

  // --- OCAP / data sovereignty ---
  exportRecords(partyId: string): Promise<ExportBundle>;
  withdraw(partyId: string): Promise<void>; // soft-delete; supplier's confirmations revert lines to 'pending'
}
