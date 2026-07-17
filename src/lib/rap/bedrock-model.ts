// ===========================================================================
// Which Claude model id does Option B invoke?
//
// Bedrock will NOT invoke a bare foundation-model id on-demand for these
// models — it rejects it at request time with:
//
//   ValidationException: Invocation of model ID anthropic.claude-sonnet-4-6
//   with on-demand throughput isn't supported. Retry your request with the ID
//   or ARN of an inference profile that contains this model.
//
// You must pass an INFERENCE PROFILE: either a geo-prefixed id ("us.<model>")
// or the ARN of an application inference profile. The default below was
// verified working (2026-07-16) from BOTH us-east-1 and ca-central-1.
//
// Residency note: there is NO Canadian geo prefix — AWS publishes only
// us/eu/au/jp, so ca-central-1 reaches Claude via the `us.` profile. Data stays
// at rest in Canada; inference geo-routes. See the governance spec §8.1.
// ===========================================================================

// Verified reachable from us-east-1 and ca-central-1.
export const DEFAULT_BEDROCK_MODEL_ID = "us.anthropic.claude-sonnet-4-6";

// AWS's documented geo prefixes for cross-region inference profiles. No `ca.`
// exists — do not add one hoping; it fails with "the provided model identifier
// is invalid".
const GEO_PREFIXES = ["us.", "eu.", "apac.", "au.", "jp.", "global."];

const isInferenceProfileArn = (id: string) =>
  id.startsWith("arn:aws:bedrock:") &&
  (id.includes(":inference-profile/") || id.includes(":application-inference-profile/"));

const hasGeoPrefix = (id: string) => GEO_PREFIXES.some((p) => id.startsWith(p));

// True when `id` is something Bedrock will actually accept for on-demand invoke.
export function isInvocableModelId(id: string): boolean {
  return isInferenceProfileArn(id) || hasGeoPrefix(id);
}

// Resolve the model id, failing LOUDLY at config time rather than with a
// cryptic ValidationException in the middle of a user's upload. `env` is passed
// in so this stays pure and testable.
// `env` is a plain record (not a narrow shape) so `process.env` assigns cleanly —
// TypeScript's weak-type check rejects ProcessEnv against an all-optional type.
export function resolveBedrockModelId(env: Record<string, string | undefined> = {}): string {
  const configured = env.BEDROCK_MODEL_ID?.trim();
  if (!configured) return DEFAULT_BEDROCK_MODEL_ID;
  if (!isInvocableModelId(configured)) {
    throw new Error(
      `BEDROCK_MODEL_ID="${configured}" is a bare model id — Bedrock rejects these for on-demand ` +
        `invocation. Use an inference profile: a geo-prefixed id (e.g. "us.${configured}") or an ` +
        `inference-profile ARN. Note there is no "ca." prefix; ca-central-1 uses the "us." profile ` +
        `(data stays at rest in Canada, inference geo-routes).`,
    );
  }
  return configured;
}
