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
  identityTier: IdentityTier; // the ownership-certification tier — the "equity" / verification layer
  ownershipPct?: number; // % Indigenous-owned (≥51 to qualify); low + self_declared = phantom-JV risk
}
export type Party = Company | Supplier;

// FlowType — the kind of economic FLOW a line records: value moving to a NAMED Indigenous
// counterparty, so that counterparty can confirm it. (Equity is NOT a flow — it's the ownership
// CERTIFICATION carried on the Supplier, below. Innovation is a TAG, not a flow.)
//   procurement = company BUYS from an Indigenous supplier            (RAP core, MVP)
//   capital     = company INVESTS equity INTO an Indigenous business  (ownership frontier, H2)
export type FlowType = "procurement" | "capital";

// Tags categorise a flow without being one (e.g. an innovation / R&D procurement line).
export type FlowTag = "innovation" | "capacity";

export type ConfirmationStatus = "pending" | "confirmed" | "disputed" | "corrected";

// A single itemized claim reported by a company about a named supplier.
export interface ReportedLine {
  id: string;
  companyId: string;
  supplierId: string;
  amount: number; // CAD
  flowType: FlowType; // procurement (buy) | capital (invest into) — the confirmable flow
  tags?: FlowTag[]; // e.g. ["innovation"] — categorises the flow, not a flow itself
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
  byFlow: Record<FlowType, { reported: number; confirmed: number }>;
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
  byFlow: Record<FlowType, { reported: number; confirmed: number }>;
  byTier: Record<IdentityTier, { confirmed: number }>; // confirmed $ by ownership-cert tier — the "equity" integrity lens
  byTag: Record<string, { confirmed: number }>; // confirmed $ carrying each tag (e.g. innovation)
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
    flowType: FlowType;
    tags?: FlowTag[];
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
