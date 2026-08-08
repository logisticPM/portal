import type { CorpusDoc } from "./types";

// The 8 clean, distinct RAPs in RAP_SAMPLES_DIR (spec §3). Page counts from pdfinfo.
export const CORPUS: CorpusDoc[] = [
  { key: "bankofcanada", fileName: "BankOfCanada_RAP.pdf", pages: 17, isGold: true },
  { key: "bcleg", fileName: "BCLeg_RAP_2024_2028.pdf", pages: 12, isGold: false },
  { key: "populous", fileName: "Populous_Reflect_RAP_2024.pdf", pages: 12, isGold: false },
  { key: "hydroquebec", fileName: "HydroQuebec_Reconciliation_Strategy.pdf", pages: 13, isGold: false },
  { key: "opg", fileName: "OPG_Reconciliation_Action_Plan_2021.pdf", pages: 33, isGold: false },
  { key: "rbc", fileName: "RBC_Pathways_to_Economic_Prosperity_RAP.pdf", pages: 35, isGold: false },
  { key: "deloitte", fileName: "Deloitte_Expanding_Horizons_RAP.pdf", pages: 41, isGold: false },
  { key: "atb", fileName: "ATB_TRAP_2025.pdf", pages: 76, isGold: false },
];
