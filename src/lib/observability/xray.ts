// ===========================================================================
// AWS X-Ray SDK-client instrumentation, for the traced extraction worker only.
//
// Wrapping an @aws-sdk/* v3 client with captureAWSv3Client makes its calls
// appear as timed subsegments under the Lambda's trace — so a slow extraction
// resolves into "138s in Bedrock, 0.3s in S3" instead of an opaque 142s. See
// docs/superpowers/specs/2026-07-28-xray-tracing-design.md.
//
// Two safety properties are load-bearing here, because this touches the
// extraction hot path:
//
//   1. ZERO IMPACT OFF-LAMBDA. AWS_XRAY_DAEMON_ADDRESS is set by the Lambda
//      runtime at init IFF the function has Active tracing. When it is absent —
//      local dev, unit tests, every function that is not the traced worker —
//      traced() returns the client untouched and never even require()s the
//      X-Ray SDK. So none of those paths change at all.
//
//   2. FAIL-OPEN. If wrapping throws (SDK version skew, a bad client shape),
//      the raw client is returned. Instrumentation must never be able to take
//      down extraction — and if it somehow degraded it, #197's alarms now fire.
// ===========================================================================

export function traced<T>(client: T): T {
  if (!process.env.AWS_XRAY_DAEMON_ADDRESS) return client;
  try {
    // Lazy require: this line only runs inside a traced Lambda, so the SDK is
    // never loaded (or bundled-and-loaded) anywhere else.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const AWSXRay = require("aws-xray-sdk-core");
    // A downstream call that happens OUTSIDE a request segment (e.g. during
    // cold-start init, before the handler's facade segment exists) must pass
    // through silently rather than throw or log-spam.
    AWSXRay.setContextMissingStrategy("IGNORE_ERROR");
    return AWSXRay.captureAWSv3Client(client as any) as T;
  } catch {
    return client;
  }
}
