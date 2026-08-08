// scripts/engine-eval/grounding.ts
import { quoteOccursIn } from "@/lib/rap/validate";
import { buildTextFromPages } from "@/lib/rap/doc-loader/textlayer";
import { pageText } from "./util";

export interface GroundingInput { quote: string | null; page: number | null }
export interface GroundingScore { total: number; quotePresent: number; pagePresent: number }

export function scoreGrounding(fields: GroundingInput[], pages: string[][]): GroundingScore {
  const fullText = buildTextFromPages(pages);
  let quotePresent = 0;
  let pagePresent = 0;
  for (const f of fields) {
    if (!f.quote) continue;
    if (quoteOccursIn(f.quote, fullText)) {
      quotePresent++;
      if (quoteOccursIn(f.quote, pageText(pages, f.page))) pagePresent++;
    }
  }
  return { total: fields.length, quotePresent, pagePresent };
}
