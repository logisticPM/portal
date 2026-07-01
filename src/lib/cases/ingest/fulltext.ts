// Pure: populate a substrate record with fetched full text (spec §3). No mutation.
// Empty text → record stays a metadata stub (some A2AJ /fetch return no text).
import { chunkText } from "./a2aj";
import type { LegalCase } from "../types";

export function applyFullText(c: LegalCase, text: string): LegalCase {
  const t = (text ?? "").trim();
  if (!t) return { ...c, fullTextAvailable: false };
  return { ...c, chunks: chunkText(t), fullTextAvailable: true };
}
