// scripts/engine-eval/util.ts
import { normalizeForQuoteMatch } from "@/lib/rap/validate";
import { readFile } from "node:fs/promises";
import { extractPagesFromPdf, buildTextFromPages } from "@/lib/rap/doc-loader/textlayer";

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

export async function loadLocalDocText(pdfPath: string): Promise<{ pages: string[][]; text: string }> {
  const bytes = new Uint8Array(await readFile(pdfPath));
  const pages = await extractPagesFromPdf(bytes);
  return { pages, text: buildTextFromPages(pages) };
}

export function pageText(pages: string[][], page: number | null): string {
  if (page == null || page < 1 || page > pages.length) return "";
  return pages[page - 1].join("\n");
}
