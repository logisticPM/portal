// Call through the response cache, and when the response does not parse, decide whether
// retrying can possibly help.
//
// It can help in exactly one situation: the response came from the CACHE, written by an
// earlier run under a smaller token budget. CallOpts are deliberately not part of the cache
// key (ingest/llm.ts), so raising a budget alone changes nothing — the truncated prose
// replays forever. Evicting first is what makes the raise take effect. cachedCall already
// refuses to store an EMPTY response for this reason; it cannot see the other version of
// the same problem, a non-empty response no parser will ever accept.
//
// It cannot help on a FRESH call: Bedrock runs at temperature 0 here, so re-issuing the
// same prompt to the same model with the same budget returns the same bytes. Retrying would
// double the cost of every genuine failure and change no outcome.
//
// Hence the pre-check, and hence its ORDER: `wasCached` must be read BEFORE the call,
// because afterwards a fresh call has written its own entry and "does a file exist" no
// longer distinguishes a replay from a first attempt.
//
// Dependencies are injected so this is testable without a filesystem or a network — the
// behaviour worth pinning is the decision, not the I/O.

export interface CacheOps {
  hasCached: (modelId: string, prompt: string) => Promise<boolean>;
  evictCached: (modelId: string, prompt: string) => Promise<boolean>;
}

export interface Callable { id: string; call: (prompt: string) => Promise<string> }

export interface ParsedResult<T> { value: T | null; repaired: boolean }

export async function callParsed<T>(
  m: Callable,
  prompt: string,
  parse: (raw: string) => T | null,
  ops: CacheOps,
): Promise<ParsedResult<T>> {
  const wasCached = await ops.hasCached(m.id, prompt);
  const first = parse(await m.call(prompt));
  if (first !== null) return { value: first, repaired: false };
  if (!wasCached) return { value: null, repaired: false };
  await ops.evictCached(m.id, prompt);
  return { value: parse(await m.call(prompt)), repaired: true };
}
