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

  // --- consensus gate (policy 2026-07-05): zero agreed themes → NOT promoted ---
  const { promoteOne } = await import("./cases-ingest");
  const mkSub = (): import("../src/lib/cases/types").LegalCase => ({
    id: "9999-test-1", citation: "9999 TEST 1", styleOfCause: "Test First Nation v. Canada",
    court: "Test Court", level: "fc", year: 2020, jurisdiction: "CA",
    nations: ["Testwa"], themes: [],
    outcome: { outcomeType: "unclassified", winType: "unclassified", whoWon: "", holding: "" },
    casesCited: [], casesCiting: [], citingCount: 0,
    enrichmentLevel: "index", corpusTier: "substrate", fullTextAvailable: true,
    chunks: [{ paragraph: "para-1", text: "The First Nation sought compensation for breach of treaty obligations." }],
    provenance: { source: "a2aj", sourceUrl: "u", upstreamLicense: "open", ingestedAt: "2026-07-05", unofficial: true },
  });
  // The stub is a pure function of (id, prompt), so search deterministic id pairs
  // for one with an EMPTY intersection and one with a NON-EMPTY intersection.
  let nonePair: string | null = null, somePair: string | null = null;
  const sub = mkSub();
  const labelText = [sub.styleOfCause, ...(sub.chunks ?? []).map((x) => x.text)].join(" ");
  for (let i = 0; i < 200 && (!nonePair || !somePair); i++) {
    process.env.LABEL_MODELS = `stub:g${i}a,stub:g${i}b`;
    const r = await labelCase(labelText);
    if (r.themes.length === 0 && !nonePair) nonePair = process.env.LABEL_MODELS;
    if (r.themes.length > 0 && !somePair) somePair = process.env.LABEL_MODELS;
  }
  assert.ok(nonePair && somePair, "stub search must find both consensus outcomes");

  process.env.LABEL_MODELS = nonePair!;
  assert.equal(await promoteOne(mkSub()), "no_consensus", "zero-consensus case must not be promoted");

  process.env.LABEL_MODELS = somePair!;
  const promoted = await promoteOne(mkSub());
  assert.ok(promoted && promoted !== "no_consensus", "consensus case must be promoted");
  assert.equal(promoted.corpusTier, "core");
  assert.ok(promoted.themes.length > 0);
  assert.equal(promoted.labelMeta?.method, "dual_llm");
  assert.notEqual(promoted.labelMeta?.agreement, "none");

  // chunk-less candidate → null (not labeled at all; title-only text is too weak,
  // and a fresh title-only cache key must not bypass the full-text gate)
  assert.equal(await promoteOne({ ...mkSub(), chunks: [] }), null);
  assert.equal(await promoteOne({ ...mkSub(), chunks: undefined }), null);

  // promoteSubstrate wiring: no_consensus is tallied in PRISMA and kept out of core
  const { promoteSubstrate } = await import("./cases-ingest");
  process.env.LABEL_MODELS = nonePair!;
  const ps = await promoteSubstrate([mkSub()]);
  assert.equal(ps.core.length, 0, "zero-consensus case must not reach core");
  assert.equal(ps.prisma.excluded.no_model_consensus, 1);
  assert.equal(ps.prisma.included, 0);

  console.log(`✅ label-llm stub e2e (a=${JSON.stringify(a1)} b=${JSON.stringify(bt)} ∩=${JSON.stringify(inter)} agreement=${expectedAgreement}) + consensus gate`);
})().catch((e) => { console.error(e); process.exit(1); });
