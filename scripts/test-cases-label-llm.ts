// Offline e2e for the labeling pipeline using the deterministic test stub
// (LABEL_MODELS=stub:a,stub:b — no key, no network). Asserts stub determinism and
// that labelCase returns exactly the intersection of the two models' theme sets.
import assert from "node:assert/strict";
import { configuredModels, labelWithModel, parseThemes } from "../src/lib/cases/ingest/llm";
import { labelCase } from "../src/lib/cases/ingest/labeler";
import { labelPrompt, ALL_THEMES } from "../src/lib/cases/ingest/rubric";

process.env.LABEL_MODELS = "stub:a,stub:b";

const TEXT = "The Crown failed to consult the Nation before issuing forestry tenures on unceded territory.";

(async () => {
  const [a, b] = configuredModels();

  // determinism: same (id, prompt) → identical themes
  const p = labelPrompt(TEXT);
  const a1 = await labelWithModel(a, p);
  const a2 = await labelWithModel(a, p);
  assert.deepEqual(a1, a2, "stub must be deterministic");

  // outputs are valid theme subsets
  const bt = await labelWithModel(b, p);
  for (const t of [...a1, ...bt]) assert.ok(ALL_THEMES.includes(t), `unknown theme ${t}`);

  // e2e: labelCase = intersection of the two stub outputs, dual_llm provenance
  const res = await labelCase(TEXT);
  const inter = a1.filter((t) => bt.includes(t));
  assert.deepEqual(res.themes, inter, "labelCase themes must equal the stub intersection");
  assert.equal(res.labelMeta.method, "dual_llm");
  assert.deepEqual(res.labelMeta.models, ["stub:a", "stub:b"]);
  const union = new Set([...a1, ...bt]);
  const expectedAgreement = union.size === 0 ? "none" : inter.length === union.size ? "full" : inter.length > 0 ? "partial" : "none";
  assert.equal(res.labelMeta.agreement, expectedAgreement);
  assert.equal(res.labelMeta.needsReview, expectedAgreement !== "full");

  // parseThemes hardening: junk in, empty out
  assert.deepEqual(parseThemes("no json here"), []);

  console.log(`✅ label-llm stub e2e (a=${JSON.stringify(a1)} b=${JSON.stringify(bt)} ∩=${JSON.stringify(inter)} agreement=${expectedAgreement})`);
})().catch((e) => { console.error(e); process.exit(1); });
