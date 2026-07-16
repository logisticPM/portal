// Pure document chunker for Option B chunked extraction. No AWS, no I/O, no env
// reads — a leaf module. Splits a RAP document into paragraph-bounded chunks so
// each can be sent to Bedrock as its own tool call, staying inside the measured
// safe regime for commitments-per-call (see below).
//
// Shape follows the house precedent (src/lib/cases/ingest/a2aj.ts chunkText /
// splitLarge — paragraph boundaries first, sentence boundaries for oversized
// paragraphs) but is reimplemented here, RAP-shaped, rather than imported: the
// cases domain returns a cases-specific CaseChunk, and domains must not import
// each other (see the src/lib/identity/ and src/lib/index-evidence/ seam).
//
// No overlap, ever. Concatenating chunks must reproduce the source exactly —
// overlap would duplicate commitments across chunks with no reliable identity
// key to dedupe them by (a commitment has no id until we assign one).

export interface DocChunk {
  text: string;
  index: number;
}

// Derived from live measurements against Bedrock, not taste — see the plan's
// Measured Facts table (docs/superpowers/plans/2026-07-16-option-b-chunked-
// extraction.md): ~410 output tokens per commitment; the synthetic RAP fixture
// ran ~340 document chars per commitment; 22 commitments (~9-10k output tokens)
// was the largest size that reliably succeeded (3/3 runs, both regions), while
// 32 failed 3/3. 6000 chars implies ~17.6 commitments (~7.2k output tokens) —
// comfortably inside the proven-good regime with margin for the ~15% run-to-run
// variance. Do not raise this "to reduce API calls" without re-measuring.
export const DEFAULT_TARGET_CHARS = 6000;

// Split a paragraph on sentence boundaries so no single piece exceeds `target`
// chars, mirroring splitLarge in a2aj.ts. A single sentence longer than target
// still becomes its own piece (over target, but never further split) — real
// RAP prose doesn't produce sentences long enough for that to matter, and
// falling back to a mid-sentence cut would defeat the "no lost meaning at
// boundaries" intent of splitting on sentences at all.
function splitLargeParagraph(para: string, target: number): string[] {
  if (para.length <= target) return [para];
  const sentences = para.split(/(?<=\.)(?:\s+|\n)/);
  const parts: string[] = [];
  let current = "";
  for (const s of sentences) {
    const candidate = current ? `${current} ${s}` : s;
    if (candidate.length > target) {
      if (current) {
        parts.push(current);
        current = s;
      } else {
        // a single sentence already over target: keep it whole
        current = s;
      }
    } else {
      current = candidate;
    }
  }
  if (current) parts.push(current);
  return parts.filter(Boolean);
}

// Split a document into paragraph-bounded chunks, each ≤ targetChars (allowing
// up to one paragraph of overshoot when a paragraph itself must be split on
// sentence boundaries). Never overlaps, never drops text: every input paragraph
// is preserved in exactly one output chunk, in document order.
export function chunkDocument(text: string, targetChars: number = DEFAULT_TARGET_CHARS): DocChunk[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .flatMap((p) => splitLargeParagraph(p, targetChars));

  const chunks: string[] = [];
  let current = "";
  for (const p of paragraphs) {
    const candidate = current ? `${current}\n\n${p}` : p;
    if (current && candidate.length > targetChars) {
      chunks.push(current);
      current = p;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);

  return chunks.map((t, i) => ({ text: t, index: i }));
}

// Split a chunk in half at the paragraph boundary nearest the middle, for a
// chunk that still truncates on extraction (Task 3's recursive retry). Returns
// null when the chunk has no internal paragraph boundary to split at — the
// caller must then fail loudly rather than silently return partial data.
export function splitInHalf(chunk: DocChunk): DocChunk[] | null {
  const paragraphs = chunk.text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  if (paragraphs.length < 2) return null;

  const mid = Math.ceil(paragraphs.length / 2);
  const first = paragraphs.slice(0, mid).join("\n\n");
  const second = paragraphs.slice(mid).join("\n\n");

  return [
    { text: first, index: chunk.index },
    { text: second, index: chunk.index },
  ];
}
