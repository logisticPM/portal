// SCC judgments are published as the bilingual Supreme Court Reports edition — French and
// English on facing pages. pdf-parse reads pages in physical order, so the extracted text
// alternates language roughly every page.
//
// Measured on Tsilhqot'in (2014 SCC 44) 2026-08-03: 265,148 characters, alternating
// FR/EN. That is over assembleInput's 240,000-char budget on its own, so the judgment would
// be summarized from a non-contiguous subset of two languages. Keeping only English gives
// ~110,000 characters.
//
// The unit is the PAGE, not a character window. A fixed window cuts mid-sentence, and every
// published claim in this product is verified by locating its quote VERBATIM in a chunk —
// a boundary through the middle of a sentence manufactures quotes that can never verify.
export type PageLang = "en" | "fr" | "unknown";

// Function words, not legal vocabulary: legal terms are cognate across the two languages
// ("appellant"/"appelant") and would not discriminate.
const FR_WORDS = /\b(que|qui|dans|pour|est|les|des|une|par|sur|aux|cette|selon|ainsi|avec|sont|leur|plus|cour|droit)\b/gi;
const EN_WORDS = /\b(the|that|which|with|from|this|were|been|shall|upon|whether|have|would|there|their|court|right)\b/gi;

const MIN_EVIDENCE = 8;   // fewer hits than this on a page is not evidence of a language
const RATIO = 1.3;        // one side must lead by this much to win

export function classifyPage(text: string): PageLang {
  const fr = (text.match(FR_WORDS) ?? []).length;
  const en = (text.match(EN_WORDS) ?? []).length;
  if (fr + en < MIN_EVIDENCE) return "unknown";
  if (en > fr * RATIO) return "en";
  if (fr > en * RATIO) return "fr";
  return "unknown";
}

export interface EnglishPages {
  text: string;
  kept: number;         // pages classified English and kept
  dropped: number;      // pages dropped (French, or undetermined without English neighbours)
  unknownKept: number;  // undetermined pages kept because both neighbours were English
}

// Keep English pages in document order. An undetermined page is kept ONLY when both its
// neighbours are English: dropping content is the conservative error for a corpus that
// publishes quotations, and an undetermined page that is really French will almost always
// sit between French pages.
export function keepEnglishPages(pages: string[]): EnglishPages {
  const langs = pages.map(classifyPage);
  const out: string[] = [];
  let kept = 0, dropped = 0, unknownKept = 0;
  for (let i = 0; i < pages.length; i++) {
    let take = langs[i] === "en";
    if (langs[i] === "unknown" && i > 0 && i < pages.length - 1 && langs[i - 1] === "en" && langs[i + 1] === "en") {
      take = true;
      unknownKept++;
    }
    if (take) { out.push(pages[i]); kept++; } else dropped++;
  }
  return { text: out.join("\n"), kept, dropped, unknownKept };
}
