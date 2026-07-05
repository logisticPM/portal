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

export const chunkSk = (n: number) => `CHUNK#${String(n).padStart(4, "0")}`;

// A case → a PROFILE item (data WITHOUT chunks + chunkCount) + one item per chunk.
// Keeps every item well under DynamoDB's 400 KB limit (spec §2).
export function caseToItems(c: LegalCase): Record<string, any>[] {
  const { chunks, ...rest } = c;
  const profile = {
    ...caseKeys.profile(c.id),
    et: "Case" as CaseEntityType,
    GSI1PK: gsi1Theme(c.themes[0] ?? "land_rights"),
    GSI1SK: gsiSk(c.year, c.id),
    GSI2PK: gsi2WinType(c.outcome.winType),
    GSI2SK: gsiSk(c.year, c.id),
    data: rest,                       // LegalCase MINUS chunks
    chunkCount: chunks?.length ?? 0,
  };
  const chunkItems = (chunks ?? []).map((ch, i) => ({
    PK: `CASE#${c.id}`,
    SK: chunkSk(i + 1),
    et: "CaseChunk" as const,
    paragraph: ch.paragraph,
    text: ch.text,
  }));
  return [profile, ...chunkItems];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// Reassemble a full LegalCase from its PROFILE item + CHUNK items (sorted by SK).
// Injects chunks into the profile data before calling itemToCase so that the field
// ordering produced by itemToCase matches the fixture order (chunks between summary
// and casesCited), preserving JSON.stringify equality against the in-memory mock.
export function reassembleCase(profileItem: any, chunkItems: any[]): LegalCase {
  const sorted = [...chunkItems].sort((a, b) => String(a.SK).localeCompare(String(b.SK)));
  const chunks = sorted.map((it: any) => ({ paragraph: it.paragraph, text: it.text }));
  if (!chunks.length) return itemToCase(profileItem);
  const syntheticItem = { ...profileItem, data: { ...profileItem.data, chunks } };
  return itemToCase(syntheticItem);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// Reconstruct LegalCase with explicit field ordering so JSON.stringify equality
// holds against the in-memory mock (DynamoDB does not preserve map-key order).
// MAINTAINER: when you add a field to LegalCase (types.ts), add it here too —
// TypeScript will NOT error on a missing field, so an omission silently drops
// data on round-trip. The deepEqual in scripts/test-cases-table.ts guards this.
export function itemToCase(it: any): LegalCase {
  const d = it.data as LegalCase;
  const c: LegalCase = {
    id: d.id,
    citation: d.citation,
    ...(d.citation2 !== undefined ? { citation2: d.citation2 } : {}),
    styleOfCause: d.styleOfCause,
    court: d.court,
    level: d.level,
    year: d.year,
    jurisdiction: d.jurisdiction,
    nations: d.nations,
    themes: d.themes,
    outcome: {
      outcomeType: d.outcome.outcomeType,
      winType: d.outcome.winType,
      whoWon: d.outcome.whoWon,
      holding: d.outcome.holding,
    },
    ...(d.economic !== undefined ? {
      economic: {
        valueType: d.economic.valueType,
        ...(d.economic.settlementAmount !== undefined ? { settlementAmount: d.economic.settlementAmount } : {}),
        ...(d.economic.resourceRevenue !== undefined ? { resourceRevenue: d.economic.resourceRevenue } : {}),
        ...(d.economic.equityStake !== undefined ? { equityStake: d.economic.equityStake } : {}),
        economicSummary: d.economic.economicSummary,
      },
    } : {}),
    ...(d.valueRealization !== undefined ? {
      valueRealization: {
        status: d.valueRealization.status,
        note: d.valueRealization.note,
        asOf: d.valueRealization.asOf,
      },
    } : {}),
    ...(d.summary !== undefined ? {
      summary: {
        claims: d.summary.claims.map((cl: any) => ({
          text: cl.text,
          sourceParagraph: cl.sourceParagraph,
          sourceUrl: cl.sourceUrl,
        })),
      },
    } : {}),
    ...(d.summaryMeta !== undefined ? { summaryMeta: d.summaryMeta } : {}),
    ...(d.chunks !== undefined ? {
      chunks: d.chunks.map((ch: any) => ({ paragraph: ch.paragraph, text: ch.text })),
    } : {}),
    casesCited: d.casesCited,
    casesCiting: d.casesCiting,
    citingCount: d.citingCount,
    enrichmentLevel: d.enrichmentLevel,
    corpusTier: d.corpusTier,
    ...(d.labelMeta !== undefined ? { labelMeta: d.labelMeta } : {}),
    fullTextAvailable: d.fullTextAvailable,
    provenance: {
      source: d.provenance.source,
      sourceUrl: d.provenance.sourceUrl,
      upstreamLicense: d.provenance.upstreamLicense,
      ingestedAt: d.provenance.ingestedAt,
      unofficial: d.provenance.unofficial,
    },
    ...(d.sensitivity !== undefined ? { sensitivity: d.sensitivity } : {}),
  };
  return c;
}
