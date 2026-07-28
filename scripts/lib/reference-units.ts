/**
 * Shared sentence-unit extraction for cross-engine comparison.
 *
 * Both sides of the comparison — Textract LAYOUT text and the text-layer
 * loader's own output — must be split and normalised IDENTICALLY, or the
 * comparison measures the splitter rather than the engines. That is the only
 * reason this lives in its own module.
 */
import { createHash } from "node:crypto";

/** The normalisation validate.ts uses for verbatim quote matching. */
export const normaliseSentence = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

/** Opaque, non-reversible key for a normalised sentence. */
export const hashKey = (key: string): string =>
  createHash("sha256").update(key).digest("hex").slice(0, 16);

/**
 * Split "[p.N]"-marked text into sentence units tagged with their page.
 *
 * Sentences rather than paragraphs: paragraph boundaries differ between the two
 * engines by construction (Textract emits LAYOUT blocks; we group glyphs
 * geometrically), so comparing paragraphs would measure that difference instead
 * of reading order. The 8-word floor keeps a match meaningful — two engines both
 * emitting "we will continue" is a coincidence, not corroboration.
 */
export function referenceUnits(text: string): { page: number; key: string }[] {
  const out: { page: number; key: string }[] = [];
  let page = 0;
  for (const block of text.split(/\n\s*\n/)) {
    const m = block.match(/^\s*\[p\.(\d+)\]/);
    if (m) page = Number(m[1]);
    for (const sentence of block.replace(/\[p\.\d+\]/g, " ").split(/(?<=[.!?])\s+/)) {
      const key = normaliseSentence(sentence);
      if (key.split(" ").length >= 8) out.push({ page, key });
    }
  }
  return out;
}
