// Tests for the pure situation-similarity module (spec 2026-07-14). Offline, no network.
import assert from "node:assert/strict";

(async () => {
  const { assembleProfileText, strengthLabel, scoreSituation } =
    await import("../src/lib/cases/similarity");
  type LC = import("../src/lib/cases/types").LegalCase;
  type SI = import("../src/lib/cases/types").SituationInput;

  const mk = (id: string, over: Partial<LC> = {}): LC => ({
    id, citation: id.toUpperCase(), styleOfCause: `Nation v. Crown (${id})`,
    court: "SCC", level: "scc", year: 2004, jurisdiction: "CA",
    nations: ["Testwa"], themes: ["duty_to_consult"],
    outcome: { outcomeType: "precedent", winType: "doctrine_win", whoWon: "Nation",
      holding: "The Crown owed a duty to consult before acting." },
    casesCited: [], casesCiting: [], citingCount: 0,
    enrichmentLevel: "index", corpusTier: "core", fullTextAvailable: true,
    summary: { claims: [{ text: "Consultation was required.", sourceParagraph: "para-1", sourceUrl: "u" }] },
    summaryMeta: { method: "llm" },
    provenance: { source: "a2aj", sourceUrl: "u", upstreamLicense: "open", ingestedAt: "2026-07-14", unofficial: true },
    ...over,
  });

  const t = assembleProfileText(mk("case-a"));
  assert.ok(t.includes("Nation v. Crown (case-a)"));
  assert.ok(t.includes("duty to consult"));
  assert.ok(t.includes("duty to consult before acting"));
  assert.ok(t.includes("Consultation was required."));
  assert.equal(assembleProfileText(mk("case-a")), t, "deterministic");
  const bare = assembleProfileText(mk("case-x", { summary: undefined, summaryMeta: undefined, outcome: { outcomeType: "precedent", winType: "unclassified", whoWon: "?", holding: "" } }));
  assert.ok(bare.includes("Nation v. Crown (case-x)"));

  assert.equal(strengthLabel(0.7), "strong");
  assert.equal(strengthLabel(0.55), "strong");
  assert.equal(strengthLabel(0.45), "moderate");
  assert.equal(strengthLabel(0.40), "moderate");
  assert.equal(strengthLabel(0.3), "weak");
  assert.equal(strengthLabel(0), "weak");

  const cases = [
    mk("a", { themes: ["duty_to_consult", "treaty"], level: "scc", citingCount: 5 }),
    mk("b", { themes: ["fiduciary"], level: "fc", citingCount: 1 }),
  ];
  const vec = (n: number) => Float32Array.from([n, 0]);
  const caseVecs = new Map<string, Float32Array>([["a", vec(1)], ["b", vec(0)]]);
  const sv = Float32Array.from([1, 0]);

  const rNarr = scoreSituation({ themes: [], narrative: "x" } as SI, cases, sv, caseVecs);
  assert.equal(rNarr[0].case.id, "a");
  assert.ok(Math.abs(rNarr[0].breakdown.composite - 1) < 1e-6);
  assert.equal(rNarr[0].breakdown.strength, "strong");

  const rTheme = scoreSituation({ themes: ["duty_to_consult"], narrative: "x" } as SI, cases, sv, caseVecs);
  assert.ok(Math.abs(rTheme[0].breakdown.composite - 1) < 1e-6);
  assert.equal(rTheme[0].breakdown.themeOverlap, 1);
  assert.deepEqual(rTheme[0].breakdown.matchedThemes, ["duty_to_consult"]);

  const rJur = scoreSituation({ themes: [], level: "scc", narrative: "x" } as SI, cases, sv, caseVecs);
  assert.equal(rJur.find((s) => s.case.id === "a")!.breakdown.sameJurisdiction, true);
  assert.equal(rJur.find((s) => s.case.id === "b")!.breakdown.sameJurisdiction, false);

  const rNull = scoreSituation({ themes: ["fiduciary"], narrative: "x" } as SI, cases, null, caseVecs);
  assert.equal(rNull[0].case.id, "b");
  assert.equal(rNull[0].breakdown.semantic, 0);

  const rEmpty = scoreSituation({ themes: [], narrative: "x" } as SI, cases, sv, new Map());
  assert.equal(rEmpty[0].breakdown.semantic, 0);

  const tie = [mk("lo", { citingCount: 1 }), mk("hi", { citingCount: 9 })];
  const rTie = scoreSituation({ themes: [], narrative: "x" } as SI, tie, null, new Map(), 1);
  assert.equal(rTie.length, 1);
  assert.equal(rTie[0].case.id, "hi");

  console.log("✅ test-cases-similarity passed");
})().catch((e) => { console.error(e); process.exit(1); });
