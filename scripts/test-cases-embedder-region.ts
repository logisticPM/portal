// Region-resolution precedence for the cases embedder (spec 2026-07-06): a
// dedicated EMBED_REGION must win over BEDROCK_REGION (which the Web function
// sets to ca-central-1 for RAP extraction) so cases embedding uses us-east-1.
import assert from "node:assert/strict";

(async () => {
  const { resolveEmbedRegion } = await import("../src/lib/cases/search/embedder");

  assert.equal(resolveEmbedRegion({ EMBED_REGION: "us-east-1", BEDROCK_REGION: "ca-central-1", AWS_REGION: "eu-west-1" }), "us-east-1");
  assert.equal(resolveEmbedRegion({ BEDROCK_REGION: "ca-central-1", AWS_REGION: "eu-west-1" }), "ca-central-1");
  assert.equal(resolveEmbedRegion({ AWS_REGION: "eu-west-1" }), "eu-west-1");
  assert.equal(resolveEmbedRegion({}), "us-east-1");
  assert.equal(resolveEmbedRegion({ EMBED_REGION: "  us-east-1  " }), "us-east-1");
  assert.equal(resolveEmbedRegion({ EMBED_REGION: "   ", BEDROCK_REGION: "ca-central-1" }), "ca-central-1");
  assert.equal(resolveEmbedRegion({ EMBED_REGION: "  ", BEDROCK_REGION: "", AWS_REGION: "eu-west-1" }), "eu-west-1");

  console.log("✅ test-cases-embedder-region passed");
})().catch((e) => { console.error(e); process.exit(1); });
