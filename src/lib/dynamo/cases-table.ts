// SINGLE-TABLE DESIGN for LegalCases (mirrors single-table.ts). Corpus is small,
// so list/search/facets Scan + filter in query.ts; GSI1/GSI2 exist for theme /
// win-type browse paths and future growth. getCase uses the main key.
import type { LegalCase, Theme, WinType } from "../cases/types";

export const GSI1 = "GSI1"; // theme browse
export const GSI2 = "GSI2"; // win-type browse
export type CaseEntityType = "Case";

export const caseKeys = {
  profile: (id: string) => ({ PK: `CASE#${id}`, SK: "PROFILE" }),
};
export const gsi1Theme = (t: Theme) => `THEME#${t}`;
export const gsi2WinType = (w: WinType) => `WINTYPE#${w}`;
export const gsiSk = (year: number, id: string) => `YEAR#${year}#CASE#${id}`;

export function toCaseItem(c: LegalCase) {
  return {
    ...caseKeys.profile(c.id),
    et: "Case" as CaseEntityType,
    GSI1PK: gsi1Theme(c.themes[0] ?? "land_rights"),
    GSI1SK: gsiSk(c.year, c.id),
    GSI2PK: gsi2WinType(c.outcome.winType),
    GSI2SK: gsiSk(c.year, c.id),
    data: c, // store the full domain object; small + read-whole access pattern
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function itemToCase(it: any): LegalCase {
  return it.data as LegalCase;
}
