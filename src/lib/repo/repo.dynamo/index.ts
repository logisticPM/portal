// ===========================================================================
// repo.dynamo — assembles the read side (Sharon) + write side (Sunny) into one
// PortalRepo. Same interface as repo.mock, so the UI never knows which is live.
// Split into reads.ts / writes.ts so the two owners never edit the same file.
// ===========================================================================
import type { PortalRepo } from "../types";
import * as reads from "./reads";
import * as writes from "./writes";

export const dynamoRepo: PortalRepo = {
  // reads / aggregates — Sharon
  getParty: reads.getParty,
  listParties: reads.listParties,
  listLinesForCompany: reads.listLinesForCompany,
  listPendingForSupplier: reads.listPendingForSupplier,
  getSupplierRecord: reads.getSupplierRecord,
  getSupplierShowcase: reads.getSupplierShowcase,
  getCoverage: reads.getCoverage,
  getIndexSummary: reads.getIndexSummary,
  exportRecords: reads.exportRecords,
  listPendingVerifications: reads.listPendingVerifications,

  // writes / integrity — Sunny
  createReportedLine: writes.createReportedLine,
  recordConfirmation: writes.recordConfirmation,
  withdraw: writes.withdraw,
  registerSupplier: writes.registerSupplier,
  registerCompany: writes.registerCompany,
  updateSupplierProfile: writes.updateSupplierProfile,
  claimVerification: writes.claimVerification,
  resolveVerification: writes.resolveVerification,

  // AUTH — user accounts
  getUserByEmail: reads.getUserByEmail,
  createUser: writes.createUser,
};
