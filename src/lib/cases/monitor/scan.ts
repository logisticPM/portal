// Additive recent-window scan (spec 2026-07-07). Harvests all theme queries over the
// window and conditionally inserts ONLY new PROFILEs (the cases-harvest-economic
// pattern) — never overwrites, promotes, or touches the artifact. harvest + send are
// injectable for offline tests.
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { casesDdbDoc as ddbDoc } from "../../dynamo/client";
import { caseToItems } from "../../dynamo/cases-table";
import { a2ajToCase, type A2ajRecord } from "../ingest/a2aj";
import { dedupeByCitation } from "../ingest/dedup";
import { harvestQuery } from "../ingest/harvest";
import { THEME_QUERIES } from "../ingest/sources";
import type { LegalCase } from "../types";
import type { ScanReport } from "./types";

const TABLE = process.env.CASES_TABLE ?? "LegalCases";
const MAX_NEW_CITATIONS = 50;

export type HarvestFn = (from: string, to: string) => Promise<A2ajRecord[]>;

// Default: harvest every theme query over [from, to] (a sub-year window = one page-set,
// so WINDOW_YEARS=1) and dedupe by citation.
const defaultHarvest: HarvestFn = async (from, to) => {
  const all: A2ajRecord[] = [];
  for (const queries of Object.values(THEME_QUERIES))
    for (const q of queries) all.push(...(await harvestQuery(q, from, to, 1)));
  return dedupeByCitation(all);
};

export interface ScanDeps { harvest?: HarvestFn; send?: (cmd: unknown) => Promise<unknown>; now?: () => Date }

export async function scanRecent(windowDays: number, deps: ScanDeps = {}): Promise<ScanReport> {
  const harvest = deps.harvest ?? defaultHarvest;
  const send = deps.send ?? ((cmd: unknown) => ddbDoc.send(cmd as never));
  const now = (deps.now ?? (() => new Date()))();
  const to = now.toISOString().slice(0, 10);
  const from = new Date(now.getTime() - windowDays * 86_400_000).toISOString().slice(0, 10);

  const raw = await harvest(from, to);
  const added: string[] = [];
  for (const r of raw) {
    const c: LegalCase = { ...a2ajToCase(r), corpusTier: "substrate" };
    const [profile] = caseToItems(c); // bare substrate → PROFILE only
    try {
      await send(new PutCommand({ TableName: TABLE, Item: profile, ConditionExpression: "attribute_not_exists(PK)" }));
      added.push(c.citation);
    } catch (e: unknown) {
      if ((e as { name?: string })?.name === "ConditionalCheckFailedException") continue; // already present → skip
      throw e;
    }
  }
  return { ts: now.toISOString(), windowDays, scanned: raw.length, added: added.length, newCitations: added.slice(0, MAX_NEW_CITATIONS) };
}
