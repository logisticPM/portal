export interface Seg { text: string; mark: boolean; }

// Split text into segments, marking case-insensitive matches of q. Preserves the
// original casing of matched substrings. Empty q → the whole text, unmarked.
export function splitHighlight(text: string, q: string): Seg[] {
  const query = q.trim();
  if (!query) return [{ text, mark: false }];
  const lower = text.toLowerCase();
  const ql = query.toLowerCase();
  const out: Seg[] = [];
  let i = 0;
  while (i < text.length) {
    const idx = lower.indexOf(ql, i);
    if (idx === -1) { out.push({ text: text.slice(i), mark: false }); break; }
    if (idx > i) out.push({ text: text.slice(i, idx), mark: false });
    out.push({ text: text.slice(idx, idx + query.length), mark: true });
    i = idx + query.length;
  }
  return out.filter((s) => s.text.length > 0);
}
