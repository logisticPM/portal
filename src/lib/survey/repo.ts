// ===========================================================================
// surveyRepo — data access for the RAP Impact Survey table (RapSurvey).
// Table-agnostic ddbDoc client + an explicit SURVEY_TABLE, so it coexists with
// the portal repo (which targets DataPortal) in the same process.
// ===========================================================================
import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../dynamo/client";
import {
  SURVEY_GSI1,
  SURVEY_TABLE,
  itemToOrg,
  itemToResponse,
  keys,
  toOrgItem,
  toResponseItem,
} from "../dynamo/survey-table";
import type { Organization, SurveyRepo, SurveyResponse } from "./types";

export const surveyRepo: SurveyRepo = {
  async putOrganization(org) {
    await ddbDoc.send(new PutCommand({ TableName: SURVEY_TABLE, Item: toOrgItem(org) }));
    return org;
  },

  async getOrganization(id) {
    const res = await ddbDoc.send(new GetCommand({ TableName: SURVEY_TABLE, Key: keys.org(id) }));
    return res.Item ? itemToOrg(res.Item) : null;
  },

  async putResponse(response) {
    await ddbDoc.send(new PutCommand({ TableName: SURVEY_TABLE, Item: toResponseItem(response) }));
    return response;
  },

  async getResponse(orgId, year) {
    const res = await ddbDoc.send(
      new GetCommand({ TableName: SURVEY_TABLE, Key: keys.response(orgId, year) }),
    );
    return res.Item ? itemToResponse(res.Item) : null;
  },

  // cross-org rollup for a reporting year (powers any aggregate Index over survey data)
  async listResponsesByYear(year) {
    const res = await ddbDoc.send(
      new QueryCommand({
        TableName: SURVEY_TABLE,
        IndexName: SURVEY_GSI1,
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: { ":pk": `YEAR#${year}` },
      }),
    );
    return ((res.Items ?? []) as Record<string, any>[]).map(itemToResponse);
  },
};
