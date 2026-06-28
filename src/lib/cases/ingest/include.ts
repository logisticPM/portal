// Transparent inclusion filter (spec §3). A candidate is CORE-eligible only if it
// shows BOTH an Indigenous-party signal AND an economic-justice theme signal in its
// text. Every exclusion carries a documented reason → PRISMA counts. Pure + testable.
import type { LegalCase } from "../types";

const INDIGENOUS = /\b(aboriginal|indigenous|first nation|m[ée]tis|inuit|treaty|band council)\b/i;
const ECONOMIC = /\b(title|duty to consult|resource|royalt|revenue|fiduciary|compensation|annuit|self-government|economic)\b/i;

export interface IncludeResult { include: boolean; reason?: string; }

function caseText(c: LegalCase): string {
  return [c.styleOfCause, c.outcome.holding, ...(c.chunks?.map((x) => x.text) ?? []),
    ...(c.summary?.claims.map((x) => x.text) ?? [])].join(" ");
}

export function includeCandidate(c: LegalCase): IncludeResult {
  const hasNation = c.nations.length > 0;
  const text = caseText(c);
  const indig = hasNation || INDIGENOUS.test(text);
  const econ = c.themes.length > 0 || ECONOMIC.test(text);
  if (!indig) return { include: false, reason: "no_indigenous_signal" };
  if (!econ) return { include: false, reason: "no_economic_theme" };
  return { include: true };
}

export interface PrismaCounts {
  identified: number; deduped: number; screened: number;
  excluded: Record<string, number>; included: number;
}
export const emptyPrisma = (): PrismaCounts => ({ identified: 0, deduped: 0, screened: 0, excluded: {}, included: 0 });
export const tallyExclude = (p: PrismaCounts, reason: string) => { p.excluded[reason] = (p.excluded[reason] ?? 0) + 1; };
