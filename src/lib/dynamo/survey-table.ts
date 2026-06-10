// ===========================================================================
// RAP Impact Survey — single-table design (SEPARATE table from the portal).
//
// One table `RapSurvey` holds two entity types; access patterns:
//   • get/put an org profile          → main:  PK=ORG#<id>   SK=PROFILE
//   • get/put a year's response        → main:  PK=ORG#<id>   SK=SURVEY#<year>
//   • all responses for a given year    → GSI1:  GSI1PK=YEAR#<year>   (cross-org rollup)
//   • orgs by industry                  → GSI2:  GSI2PK=INDUSTRY#<industry>
//
// Same generic key attributes (PK/SK/GSI1PK/GSI1SK/GSI2PK/GSI2SK) as the portal
// table, so `scripts/create-table.ts` creates it too — just set DYNAMO_TABLE=RapSurvey.
// ===========================================================================
import type { Organization, SurveyResponse } from "../survey/types";

export const SURVEY_TABLE = process.env.SURVEY_TABLE ?? "RapSurvey";
export const SURVEY_GSI1 = "GSI1"; // responses by reporting year
export const SURVEY_GSI2 = "GSI2"; // organizations by industry

export const keys = {
  org: (id: string) => ({ PK: `ORG#${id}`, SK: "PROFILE" }),
  response: (orgId: string, year: string) => ({ PK: `ORG#${orgId}`, SK: `SURVEY#${year}` }),
};

export type SurveyEntityType = "Org" | "Response";

// --- marshalling: domain object → table item -------------------------------
export function toOrgItem(o: Organization) {
  return {
    ...keys.org(o.id),
    et: "Org" as SurveyEntityType,
    GSI2PK: `INDUSTRY#${o.industry}`,
    GSI2SK: `ORG#${o.id}`,
    ...o,
  };
}

export function toResponseItem(r: SurveyResponse) {
  return {
    ...keys.response(r.orgId, r.year),
    et: "Response" as SurveyEntityType,
    GSI1PK: `YEAR#${r.year}`,
    GSI1SK: `ORG#${r.orgId}`,
    ...r,
  };
}

// --- unmarshalling: table item → domain object (strip the key attributes) ---
/* eslint-disable @typescript-eslint/no-unused-vars */
export function itemToOrg(it: Record<string, any>): Organization {
  const { PK, SK, et, GSI1PK, GSI1SK, GSI2PK, GSI2SK, ...org } = it;
  return org as Organization;
}

export function itemToResponse(it: Record<string, any>): SurveyResponse {
  const { PK, SK, et, GSI1PK, GSI1SK, GSI2PK, GSI2SK, ...response } = it;
  return response as SurveyResponse;
}
