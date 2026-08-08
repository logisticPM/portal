// Bounded retry-on-throttle for the measurement harness, not for the product.
//
// Same shape in, same shape out as ingest/llm.ts's cachedModel, so the two compose:
// retryingModel(cachedModel(m), opts) retries only on a genuine cache miss, because a cache
// hit resolves inside cachedCall before this wrapper's underlying `m.call` is ever reached.
// Order matters — cachedModel(retryingModel(m, opts)) would retry BEHIND the cache, so a
// cached entry could itself be the product of a retry the cache key has no way to record.
//
// Why here and not in ingest/llm.ts: llm.ts is the product's model client, and every caller
// that imports it — including the live labeler — would inherit whatever retry policy lived
// there, whether or not that caller already has its own. Some do (rap/pipeline.bedrock.ts
// retries a transient STREAM error itself, with its own backoff schedule) and some
// deliberately don't (rap/actions-core.ts's retryFailedJob comment: an unattended retry
// against a permanent denial is an unbounded loop). This harness has no such story of its
// own — it fires ~360 Bedrock calls from one process with nothing else managing
// backpressure, so throttling here is the ordinary cost of that shape, not a special case
// any one caller opted into. The decision of how hard to retry belongs to the thing that
// creates this load, not to the shared client every product path depends on, which is the
// whole reason this is a separate module under sufficiency/ instead of a few lines in
// llm.ts.
//
// Why "succeeded on retry" must not count as a call failure while "never succeeded" still
// must: tally.ts's assertNoCallFailures throws on ANY call failure because a failed call
// reached no model and is therefore evidence about nothing — a rate computed over the
// survivors of an outage is not a rate. That reasoning holds exactly as written for a call
// that exhausts every attempt. It does NOT hold for a call throttled on attempt 1 and
// answered on attempt 2: the request reached the model, the model answered, and that
// response is real evidence for or against the rater — indistinguishable from a first-try
// success. Treating it as a failure anyway would make the guard fire on ordinary
// infrastructure noise and abort otherwise-good runs (the ~360-call run this module exists
// to fix); treating an EXHAUSTED call as a success would let a genuine outage hide behind
// "well, it retried, didn't it" and silently shrink the population the guard exists to
// protect. So this module swallows a transient error the instant a later attempt succeeds,
// and rethrows the LAST attempt's error unchanged — the same object, never a copy or a new
// error of this module's own making — the instant attempts run out, so the caller's existing
// try/catch (which is what increments callFailures) sees a genuine failure exactly when, and
// only when, there is one.
import type { LlmModel } from "../ingest/llm";

export interface RetryOpts {
  attempts: number;
  baseDelayMs: number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (attempt: number, e: unknown) => void;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// The Bedrock/service exceptions known to mean "infrastructure declined to even try this
// request", matched against both the error's name (how the AWS SDK's modeled exceptions
// actually surface — e.g. a thrown ThrottlingException has .name === "ThrottlingException")
// and its message (in case something between the SDK and this call wraps or re-stringifies
// it). "Too many requests" is listed separately because it is ThrottlingException's own
// literal message text, not a class name — the thing that actually aborted the run this
// module exists to fix — so matching it directly catches a differently-wrapped throttle too.
const TRANSIENT_NAMES = [
  "ThrottlingException",
  "TooManyRequestsException",
  "ServiceUnavailableException",
  "ModelTimeoutException",
  "InternalServerException",
];

// Conservative on purpose: anything not on this short list returns false. A truncation error
// (llm.ts's "response truncated at maxTokens") is a real failure of the run's own making, not
// infrastructure noise, and must never be retried into a false success — retrying it changes
// nothing (same prompt, same budget, same truncation) except which attempt gets the blame. A
// wrongly-transient classification is the dangerous direction of error here: it silently
// retries a real failure, and if the retry happens to succeed for an unrelated reason, it
// reports success over what was actually a defect.
export function isTransient(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const { name, message } = e;
  for (const marker of TRANSIENT_NAMES) {
    if (name === marker || message.includes(marker)) return true;
  }
  return message.includes("Too many requests");
}

// Wrap a model so a transient error is retried, with exponential backoff, before it ever
// reaches the caller: baseDelayMs * 2^(attempt-1), plus jitter drawn from [0, baseDelayMs).
// Bounding the jitter to less than one more baseDelayMs is what keeps the delay sequence
// non-decreasing call to call — the next step's minimum (2x the prior base, no jitter) is
// never less than this step's maximum (1x the prior base, plus almost a full baseDelayMs of
// jitter) — so backoff growth is guaranteed by construction, not by chance.
//
// `sleep` is injected (defaulting to a real setTimeout-backed wait) so tests can assert on
// the recorded delays without spending real wall-clock time. `onRetry` is injected so a
// caller can observe — and count — how many times a call needed a second try.
export function retryingModel(m: LlmModel, opts: RetryOpts): LlmModel {
  const { attempts, baseDelayMs, onRetry } = opts;
  const sleep = opts.sleep ?? defaultSleep;
  return {
    id: m.id,
    call: async (prompt: string): Promise<string> => {
      for (let attempt = 1; ; attempt++) {
        try {
          return await m.call(prompt);
        } catch (e) {
          // The one throw in this loop, reached either on the FIRST attempt (a non-transient
          // error — no retry budget is spent on a failure retrying cannot fix) or the LAST
          // (a transient error that never succeeded) — never in between, and never replaced
          // with a new Error of this module's own making.
          if (!isTransient(e) || attempt >= attempts) throw e;
          onRetry?.(attempt, e);
          await sleep(baseDelayMs * 2 ** (attempt - 1) + Math.random() * baseDelayMs);
        }
      }
    },
  };
}
