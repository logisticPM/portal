// Option B's model id must be an INFERENCE PROFILE — Bedrock rejects bare
// model ids for on-demand invoke, which made Option B dead on arrival.
// Run: npx tsx scripts/test-bedrock-model.ts
import {
  DEFAULT_BEDROCK_MODEL_ID,
  isInvocableModelId,
  resolveBedrockModelId,
} from "../src/lib/rap/bedrock-model";

let fail = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  if (!ok) fail++;
}

// The regression this file exists for: the old default was a bare model id and
// every Option B call died with a ValidationException.
check(
  "the DEFAULT model id is invocable (not a bare model id)",
  isInvocableModelId(DEFAULT_BEDROCK_MODEL_ID),
);
check(
  "the old broken default would be rejected",
  !isInvocableModelId("anthropic.claude-sonnet-4-6"),
);

// Accepts what Bedrock accepts.
check("geo-prefixed id accepted", isInvocableModelId("us.anthropic.claude-sonnet-4-6"));
check("eu geo prefix accepted", isInvocableModelId("eu.anthropic.claude-sonnet-4-5-20250929-v1:0"));
check(
  "inference-profile ARN accepted",
  isInvocableModelId("arn:aws:bedrock:ca-central-1:106189426706:inference-profile/us.anthropic.claude-sonnet-4-6"),
);
check(
  "application-inference-profile ARN accepted",
  isInvocableModelId("arn:aws:bedrock:ca-central-1:106189426706:application-inference-profile/abc123"),
);

// There is no Canadian geo prefix — guard against someone "fixing" residency
// by inventing one (it fails at runtime with an invalid-identifier error).
check("there is no ca. geo prefix", !isInvocableModelId("ca.anthropic.claude-sonnet-4-6"));

// Resolution.
check("unset env → the working default", resolveBedrockModelId({}) === DEFAULT_BEDROCK_MODEL_ID);
check(
  "empty/whitespace env → the working default",
  resolveBedrockModelId({ BEDROCK_MODEL_ID: "   " }) === DEFAULT_BEDROCK_MODEL_ID,
);
check(
  "a valid override is honoured",
  resolveBedrockModelId({ BEDROCK_MODEL_ID: "us.anthropic.claude-sonnet-4-5-20250929-v1:0" }) ===
    "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
);
check(
  "an override is trimmed",
  resolveBedrockModelId({ BEDROCK_MODEL_ID: " us.anthropic.claude-sonnet-4-6 " }) ===
    "us.anthropic.claude-sonnet-4-6",
);

// Fail loudly at config time, not mid-upload.
let threw = false;
let msg = "";
try {
  resolveBedrockModelId({ BEDROCK_MODEL_ID: "anthropic.claude-sonnet-4-6" });
} catch (e) {
  threw = true;
  msg = String(e);
}
check("a bare model id throws instead of failing at request time", threw);
check("the error tells you the actual fix (use a profile)", /us\.anthropic\.claude-sonnet-4-6/.test(msg));

process.exit(fail ? 1 : 0);
