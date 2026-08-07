// scripts/engine-eval/util.ts
import { normalizeForQuoteMatch } from "@/lib/rap/validate";

export function tokenSet(s: string): Set<string> {
  return new Set(normalizeForQuoteMatch(s).split(" ").filter((t) => t.length > 2));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}
