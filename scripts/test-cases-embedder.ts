import assert from "node:assert/strict";
import { getEmbedder, StubEmbedder } from "../src/lib/cases/search/embedder";

(async () => {
  const e = new StubEmbedder(1024);
  assert.equal(e.id, "stub-hash-v1");
  assert.equal(e.dim, 1024);

  const [a] = await e.embed(["aboriginal title established"]);
  const [a2] = await e.embed(["aboriginal title established"]);
  const [b] = await e.embed(["fisheries licensing dispute"]);

  assert.equal(a.length, 1024, "dim");
  assert.deepEqual(Array.from(a), Array.from(a2), "deterministic: same text → same vector");
  assert.ok(Array.from(a).some((x, i) => x !== b[i]), "different text → different vector");

  // L2-normalized → norm ≈ 1
  const norm = Math.sqrt(Array.from(a).reduce((s, x) => s + x * x, 0));
  assert.ok(Math.abs(norm - 1) < 1e-5, "L2-normalized");

  // factory falls back to the stub when no EMBED_PROVIDER is set
  delete process.env.EMBED_PROVIDER;
  assert.equal(getEmbedder().id, "stub-hash-v1", "no key → stub");

  console.log("✅ embedder tests passed");
})().catch((e) => { console.error("❌ test failed:", e); process.exit(1); });
