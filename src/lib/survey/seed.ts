// Seed loader for the RAP Impact Survey table. Idempotent (Put overwrites).
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../dynamo/client";
import { SURVEY_TABLE, toOrgItem, toResponseItem } from "../dynamo/survey-table";
import { organizations, responses } from "./fixtures";

export async function seedSurvey(): Promise<{ organizations: number; responses: number }> {
  for (const o of organizations) {
    await ddbDoc.send(new PutCommand({ TableName: SURVEY_TABLE, Item: toOrgItem(o) }));
  }
  for (const r of responses) {
    await ddbDoc.send(new PutCommand({ TableName: SURVEY_TABLE, Item: toResponseItem(r) }));
  }
  return { organizations: organizations.length, responses: responses.length };
}
