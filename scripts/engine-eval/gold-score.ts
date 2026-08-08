import { normalizeForQuoteMatch } from "@/lib/rap/validate";

export interface GoldEntry { page: number; action: string }
export interface GoldScore {
  precision: number; recall: number; f1: number;
  actionMatches: number; pageMatches: number;
  extractedCount: number; goldCount: number; misses: string[];
}

type ExtractedLike = { action: { value: string | null }; page: number | null };

export function scoreAgainstGold(commitments: ExtractedLike[], gold: GoldEntry[]): GoldScore {
  const usedExtracted = new Set<number>();
  let actionMatches = 0;
  let pageMatches = 0;
  const misses: string[] = [];

  for (const g of gold) {
    const goldNorm = normalizeForQuoteMatch(g.action);
    const needle = goldNorm.slice(0, 40);
    let matched = -1;
    for (let i = 0; i < commitments.length; i++) {
      if (usedExtracted.has(i)) continue;
      const v = commitments[i].action.value;
      if (v && normalizeForQuoteMatch(v).includes(needle)) { matched = i; break; }
    }
    if (matched === -1) { misses.push(g.action); continue; }
    usedExtracted.add(matched);
    actionMatches++;
    if (commitments[matched].page === g.page) pageMatches++;
  }

  const extractedCount = commitments.length;
  const goldCount = gold.length;
  const precision = extractedCount ? actionMatches / extractedCount : 0;
  const recall = goldCount ? actionMatches / goldCount : 0;
  const f1 = precision && recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1, actionMatches, pageMatches, extractedCount, goldCount, misses };
}
