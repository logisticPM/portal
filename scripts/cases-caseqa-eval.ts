// Answer-quality evaluation for "Ask this judgment" (spec 2026-08-03).
//
// Known-answer construction: pick a target paragraph, have one model write a lay question
// it answers, have the PRODUCT answer that question, then have a THIRD model judge whether
// each published sentence is supported by the paragraph it cites. Three of the four metrics
// are objective because the target paragraph is ground truth by construction.
//
// Needs DynamoDB read + Bedrock. Writes nothing to the table.
import "./fetch-polyfill";
import { dynamoCaseRepo } from "../src/lib/cases/repo.dynamo";
import { modelFromId, cachedModel } from "../src/lib/cases/ingest/llm";
import { assembleInput } from "../src/lib/cases/ingest/summarizer";
import { answerCaseQuestion } from "../src/lib/cases/caseqa/generator";
import { pickTargets, buildQuestionPrompt, isLexicalGimme, isWellFormedQuestion } from "../src/lib/cases/caseqa-eval/construct";
import { buildFaithfulnessPrompt, parseVerdict, buildAddressedPrompt, parseAddressed, buildSubstantivePrompt, parseSubstantive, type Verdict } from "../src/lib/cases/caseqa-eval/judge";
import { score, type EvalRecord, type ClaimRecord, type FaithfulnessTally } from "../src/lib/cases/caseqa-eval/metrics";
import { assertDistinctModels, formatProvenance, formatChosenTargets } from "../src/lib/cases/caseqa-eval/guards";
import { buildUnanswerablePairs } from "../src/lib/cases/caseqa-eval/pairing";
import { SCREENING } from "../src/lib/cases/screening";

const SEED = Number(process.env.EVAL_SEED ?? 1);
const N_ANSWERABLE = Number(process.env.EVAL_ANSWERABLE ?? 40);
const N_UNANSWERABLE = Number(process.env.EVAL_UNANSWERABLE ?? 20);

// Model ids are VERIFIED INVOCABLE on this account, not chosen from memory. The plan's
// original defaults (claude-3-5-sonnet-20241022, claude-3-7-sonnet-20250219) were both dead:
// the first smoke run aborted with "This model version has reached the end of its life."
// A second guess (claude-opus-4-7) is listed ACTIVE by list-inference-profiles yet returned
// "is not available for this account" — so ACTIVE in that listing does NOT mean invocable
// here. Each id below was confirmed with a real one-token Converse call.
//
// WRITER: already proven in this repo by the briefs path. JUDGE: the strongest
// confirmed-invocable model, because faithfulness is the one metric that needs judgment.
// ANSWERER: the PRODUCT's own model — changing it would measure something else.
const WRITER = process.env.EVAL_WRITER_MODEL ?? "us.anthropic.claude-sonnet-4-6";
const ANSWERER = process.env.EVAL_ANSWER_MODEL ?? "us.meta.llama3-3-70b-instruct-v1:0";
const JUDGE = process.env.EVAL_JUDGE_MODEL ?? "us.anthropic.claude-opus-4-5-20251101-v1:0";

// FIX A (2026-08-03 review, BLOCKING): `modelFromId(id)` with no options defaults to
// `maxTokens: 256` (ingest/llm.ts). That default was written for theme labels, not for this
// instrument, and left unset here it silently starved every model in this file. Each budget
// below is now explicit and sized for what THAT model actually emits:
//
// - ANSWERER must match or exceed the product's own budget (`caseqa/run.ts` calls
//   `modelFromId(..., { maxTokens: 1024 })`). The ask prompt allows up to 6 claims of
//   {text, quote, paragraph} JSON — 300-450 tokens for six — so at 256 the JSON truncates
//   mid-structure, `parseClaims` (strict JSON.parse, no repair) returns null,
//   `answerCaseQuestion` retries once, truncates again, and returns `failKind: "unparseable"`.
//   Every question becomes a refusal, and the run prints `responsiveness 0.0%`,
//   `false-refusal 100%`, `judged 0`, `CONTRADICTED 0` — the headline safety criterion met by
//   starvation, exit 0, failure attributed to the product. This instrument measures the
//   product; giving the answerer less than the product's own budget measures a starved
//   stand-in of it instead.
// - WRITER emits ONE plain-text (not JSON) first-person question, instructed to be 2-4
//   sentences (~60-120 words, ~90-160 tokens). Budgeted with roughly 2.5x headroom so a
//   wordier-than-instructed model still finishes its sentence rather than being cut mid-word —
//   textFromConverse only throws on FULL truncation (no text part at all), so a partial
//   question would otherwise pass through silently as a garbled one.
// - JUDGE emits exactly one JSON field ({"verdict":"..."} or {"addressed":true|false}), ~10
//   tokens of payload. 256 is the same figure the ingest default already used; made explicit
//   here (rather than left implicit) because "explicit" is the point of this fix, and this
//   value already has generous headroom over models that wrap the JSON in a sentence or a
//   code fence (both of which `firstJson` in judge.ts already tolerates).
//
// `cachedCall`'s cache key is sha256(modelId + "\n" + prompt) — CallOpts, including
// maxTokens, is deliberately NOT part of it (ingest/llm.ts). Raising or lowering any budget
// below after a prompt has already been cached REPLAYS the old, possibly-truncated output;
// clear scripts/.cache/llm for the affected prompts (or the whole directory) whenever one of
// these numbers changes.
const WRITER_MAX_TOKENS = 400;
const ANSWERER_MAX_TOKENS = 1024;
const JUDGE_MAX_TOKENS = 256;

async function main() {
  // Guard 1 (spec §7), in guards.ts so it has a test.
  assertDistinctModels({ writer: WRITER, answerer: ANSWERER, judge: JUDGE });
  // Construction and judging are cached so re-running after an ANSWERER change replays the
  // same questions and the same verdicts. The answerer is deliberately uncached — it is the
  // thing under measurement.
  const writer = cachedModel(modelFromId(WRITER, { maxTokens: WRITER_MAX_TOKENS }));
  const judge = cachedModel(modelFromId(JUDGE, { maxTokens: JUDGE_MAX_TOKENS }));
  const answerer = modelFromId(ANSWERER, { maxTokens: ANSWERER_MAX_TOKENS });

  const profiles = await dynamoCaseRepo.listCases({ tier: "core" });
  const cases = [];
  for (const p of profiles) {
    const c = await dynamoCaseRepo.getCase(p.id);
    if (c?.chunks?.length) cases.push(c);
  }
  // Guard 3: an empty population is an error. cases-eval.ts printed a full scorecard of
  // zeros and exited 0 on 2026-08-02.
  if (!cases.length) throw new Error("no core case has chunks — this run would measure nothing");

  // Built before target selection because stage 2 needs each candidate's styleOfCause. The
  // existing `byId` below is left as-is so nothing downstream changes.
  const byIdAll = new Map(cases.map((c) => [c.id, c]));

  const { targets: shapedTargets, noLongPara, rejectedByShape: targetsRejectedByShape } =
    pickTargets(cases, SEED, N_ANSWERABLE);

  // Stage 2 (spec §3): stage 1's line-shape test cannot catch back matter — a solicitors'
  // register and a list of authorities are long single lines that clear it. One cached judge
  // call per candidate. No backfill on rejection: a skipped case stays skipped, matching what
  // the character floor already does, so the sample stays a function of the seed rather than
  // of the rejection rate.
  let targetsRejectedByJudge = 0, targetJudgeUnparsed = 0;
  const targets: typeof shapedTargets = [];
  for (const t of shapedTargets) {
    const c = byIdAll.get(t.caseId)!;
    const substantive = parseSubstantive(await judge.call(buildSubstantivePrompt(t.text, c.styleOfCause)));
    // Unparseable is counted apart from a `false` and never defaulted: defaulting to true
    // readmits the front matter this stage exists to exclude, and defaulting to false shrinks
    // the sample on the strength of a judge failure. Neither is a claim we have earned.
    if (substantive === null) { targetJudgeUnparsed++; continue; }
    if (!substantive) { targetsRejectedByJudge++; continue; }
    targets.push(t);
  }
  if (!targets.length) {
    throw new Error("every candidate target was rejected by the shape filter or the substance screen — nothing to measure");
  }
  console.log(formatChosenTargets(targets));
  const byId = new Map(cases.map((c) => [c.id, c]));

  // --- construct questions -------------------------------------------------------
  let gimmes = 0, writerFails = 0, writerMalformed = 0;
  const built: { caseId: string; qid: string; question: string; targetParagraph: string }[] = [];
  for (const t of targets) {
    const c = byId.get(t.caseId)!;
    const question = (await writer.call(buildQuestionPrompt(c, t))).trim();
    if (!question) { writerFails++; continue; }
    // Counted apart from writerFails: an empty response and a response truncated mid-sentence
    // are both harness failures, but only the second one would otherwise reach the answerer and
    // be scored as if the product could not answer it.
    if (!isWellFormedQuestion(question)) { writerMalformed++; continue; }
    // Guard 2: a verbatim run would let the retriever win on string overlap.
    if (isLexicalGimme(question, t.text)) { gimmes++; continue; }
    built.push({ caseId: t.caseId, qid: `ans-${built.length + 1}`, question, targetParagraph: t.paragraph });
  }
  if (!built.length) throw new Error("every constructed question was rejected — nothing to measure");

  // --- pair unanswerables, then VALIDATE them (spec §5) --------------------------
  // FIX B (2026-08-03 review, BLOCKING): candidate drawing and rejection-tracking live in
  // pairing.ts now (unit-tested there, including the "one always-addressed case" scenario) —
  // see that file's header comment for what was wrong with the inline `built.find(...)` loop
  // this replaced (a rejected candidate was never marked used, so `built.find` kept handing
  // the same rejected candidate to every later source).
  const { pairs, discardedPairs, addressedFails, exhausted: pairingExhausted } =
    await buildUnanswerablePairs(built, N_UNANSWERABLE, SEED, async (source, candidate) => {
      const target = byId.get(candidate.caseId)!;
      const raw = await judge.call(buildAddressedPrompt(source.question, target.styleOfCause,
        assembleInput(target.chunks!, target.outcome.holding)));
      // Unparseable or genuinely addressed: DISCARD, do not count as either bucket.
      // Counting an addressed pair as unanswerable would inflate false-answer rate with
      // correct answers.
      return parseAddressed(raw);
    });

  // --- ask the product, then judge each published claim --------------------------
  const judgeClaims = async (c: { chunks?: { paragraph: string; text: string }[] }, claims: { text: string; sourceParagraph: string }[]) => {
    const out: ClaimRecord[] = [];
    for (const cl of claims) {
      const para = (c.chunks ?? []).find((ch) => ch.paragraph === cl.sourceParagraph);
      // FIX E (2026-08-03 review): this used to be commented as detecting a live product bug.
      // It cannot: verifyClaims (ingest/summarizer.ts) builds every anchor's sourceParagraph
      // from this SAME chunks array, so a mismatch here cannot occur through normal operation
      // — it is an invariant, kept as a cheap sanity check, not a detector. Left in because if
      // it ever DID fire it would abort a fully paid run before provenance is even printed,
      // which is worth knowing rather than silently mis-scoring.
      if (!para) throw new Error(`anchor cites ${cl.sourceParagraph}, absent from chunks`);
      let verdict: Verdict | null;
      try {
        verdict = parseVerdict(await judge.call(buildFaithfulnessPrompt(cl.text, para.text)));
      } catch (e) {
        // FIX C (2026-08-03 review, IMPORTANT): a judge-call exception (Bedrock throttling,
        // or ingest/llm.ts's truncation throw) is the JUDGE failing, not the ANSWER. Before
        // this fix, `judgeClaims(...)` ran inside the `try` around `answerCaseQuestion`
        // (in the argument position of `records.push`), so this exception propagated out,
        // the record was pushed with `outcome: "errored"`, and a correctly-answered question
        // vanished from both the numerator AND denominator of responsivenessAtPara and
        // falseRefusalRate — with only a warn line as any trace. `verdict: null` is the
        // channel that already exists for exactly this ("the judge failed to return a
        // parseable verdict" — counted as `unparsed`, never folded into a verdict bucket),
        // and it is the right one regardless of WHY the judge failed.
        console.warn(`   ⚠ judge call failed on a claim citing ${cl.sourceParagraph}: ${e instanceof Error ? e.message : String(e)}`);
        verdict = null;
      }
      out.push({ text: cl.text, sourceParagraph: cl.sourceParagraph, verdict });
    }
    return out;
  };

  const records: EvalRecord[] = [];
  let targetDroppedByBudget = 0;
  for (const b of built) {
    const c = byId.get(b.caseId)!;
    // FIX D (2026-08-03 review, IMPORTANT): assembleInput (ingest/summarizer.ts) has a
    // 240,000-char budget; over budget it keeps a non-contiguous subset of chunks and drops
    // the rest. pickTargets has no such filter, so on a very long judgment the "ground truth
    // by construction" target paragraph can be absent from the prompt the answerer actually
    // sees — guaranteeing a non-responsive answer or a refusal that this instrument would then
    // score as a PRODUCT failure, when the real cause is upstream of it. assembleInput is pure
    // and deterministic (answerCaseQuestion recomputes the identical assembly internally), so
    // checking this here costs nothing beyond the recomputation.
    const assembled = assembleInput(c.chunks!, c.outcome.holding);
    if (!assembled.includes(`[para ${b.targetParagraph}]`)) { targetDroppedByBudget++; continue; }
    try {
      const r = await answerCaseQuestion(c, c.chunks!, b.question, answerer);
      if (r.status === "done") {
        records.push({ kind: "answerable", caseId: b.caseId, qid: b.qid, targetParagraph: b.targetParagraph,
          outcome: "answered", citedParagraphs: r.answer.claims.map((x) => x.sourceParagraph),
          claims: await judgeClaims(c, r.answer.claims), droppedClaims: r.dropped });
      } else {
        records.push({ kind: "answerable", caseId: b.caseId, qid: b.qid, targetParagraph: b.targetParagraph,
          outcome: "refused", failKind: r.failKind, citedParagraphs: [], claims: [],
          droppedClaims: 0, bestOverlap: r.bestOverlap });
      }
    } catch (e) {
      console.warn(`   ⚠ ${b.qid} errored: ${e instanceof Error ? e.message : String(e)}`);
      records.push({ kind: "answerable", caseId: b.caseId, qid: b.qid, targetParagraph: b.targetParagraph,
        outcome: "errored", citedParagraphs: [], claims: [], droppedClaims: 0 });
    }
  }
  for (const p of pairs) {
    const c = byId.get(p.caseId)!;
    try {
      const r = await answerCaseQuestion(c, c.chunks!, p.question, answerer);
      if (r.status === "done") {
        records.push({ kind: "unanswerable", caseId: p.caseId, qid: p.qid, outcome: "answered",
          claims: await judgeClaims(c, r.answer.claims), droppedClaims: r.dropped });
      } else {
        records.push({ kind: "unanswerable", caseId: p.caseId, qid: p.qid, outcome: "refused",
          failKind: r.failKind, claims: [], droppedClaims: 0 });
      }
    } catch (e) {
      console.warn(`   ⚠ ${p.qid} errored: ${e instanceof Error ? e.message : String(e)}`);
      records.push({ kind: "unanswerable", caseId: p.caseId, qid: p.qid, outcome: "errored",
        claims: [], droppedClaims: 0 });
    }
  }

  // --- Guard 5: provenance BEFORE the metrics ------------------------------------
  console.log(formatProvenance({
    writer: WRITER, answerer: ANSWERER, judge: JUDGE, seed: SEED,
    // The corpus snapshot the sample was drawn against — see the comment on Provenance.asOf
    // in guards.ts for why this has to come from the corpus, not from "now".
    asOf: SCREENING.asOf,
    casesWithChunks: cases.length, targets: targets.length,
    built: built.length, gimmes, writerFails, writerMalformed,
    pairs: pairs.length, discardedPairs, addressedFails,
    pairingExhausted, targetDroppedByBudget,
    noLongPara, targetsRejectedByShape, targetsRejectedByJudge, targetJudgeUnparsed,
  }));
  console.log(`(requested ${N_ANSWERABLE} answerable / ${N_UNANSWERABLE} unanswerable)`);

  const m = score(records);
  console.log(`\n--- answerable (target paragraph known by construction) ---`);
  console.log(`  attempted ${m.answerable.attempted} · answered ${m.answerable.answered}` +
    ` · refused ${m.answerable.refused} · errored ${m.answerable.errored}`);
  console.log(`  responsiveness@para  ${(m.answerable.responsivenessAtPara * 100).toFixed(1)}%` +
    `  (${m.answerable.responsive}/${m.answerable.answered} answered cited the target)`);
  console.log(`  false-refusal rate   ${(m.answerable.falseRefusalRate * 100).toFixed(1)}%` +
    `  (of answered+refused; errored excluded)`);
  console.log(`  failKinds ${JSON.stringify(m.answerable.failKinds)}`);
  // Spec §4: bestOverlap conditions the `unverifiable` count. A refusal at 0.94 is a
  // near-miss the guard declined; one at 0.10 is the model not quoting the judgment at all,
  // and the two should never be read as the same failure.
  const unver = records.filter((r): r is Extract<EvalRecord, { kind: "answerable" }> =>
    r.kind === "answerable" && r.failKind === "unverifiable" && r.bestOverlap !== undefined);
  if (unver.length) {
    const os = unver.map((r) => r.bestOverlap!).sort((a, b) => a - b);
    // FIX E (2026-08-03 review): this was `os[Math.floor(os.length / 2)]` labelled "median",
    // which for an EVEN n is the upper-middle element, not the median (e.g. n=4 -> index 2,
    // the 3rd of 4 values). A real median averages the two middle values when n is even.
    const mid = Math.floor(os.length / 2);
    const median = os.length % 2 === 0 ? (os[mid - 1] + os[mid]) / 2 : os[mid];
    console.log(`  unverifiable bestOverlap (n=${os.length}): min ${os[0].toFixed(2)}` +
      ` · median ${median.toFixed(2)} · max ${os[os.length - 1].toFixed(2)}`);
  }

  console.log(`\n--- unanswerable (cross-case; correct behaviour is refusal) ---`);
  console.log(`  attempted ${m.unanswerable.attempted} · answered ${m.unanswerable.answered}` +
    ` · refused ${m.unanswerable.refused} · errored ${m.unanswerable.errored}`);
  // FIX E: this was the only one of the four §4 metrics printed with no inline denominator
  // (spec §11: "Four metrics printed with their denominators"). With the pairing collapse
  // from FIX B, n could be 1 and the line read `false-answer rate 0.0%` with a false air of
  // precision. Denominator excludes errored, same as falseRefusalRate above it.
  const decidedU = m.unanswerable.answered + m.unanswerable.refused;
  console.log(`  false-answer rate    ${(m.unanswerable.falseAnswerRate * 100).toFixed(1)}%` +
    `  (${m.unanswerable.answered}/${decidedU} decided answered; errored excluded)`);
  console.log(`  failKinds ${JSON.stringify(m.unanswerable.failKinds)}`);

  // FIX E: faithfulness is now printed split by bucket (spec §4) — a claim published in
  // answer to an UNANSWERABLE question is a false answer by construction and skews
  // `unrelated` almost by definition; blending it into one rate let a bad false-answer rate
  // masquerade as a faithfulness problem, with nothing in the output to tell the two apart.
  console.log(`\n--- faithfulness (LLM-judged, against the cited paragraph) ---`);
  const printFaithfulness = (label: string, f: FaithfulnessTally) => {
    console.log(`  [${label}] judged ${f.judged} claims · unparsed verdicts ${f.unparsed}`);
    console.log(`  [${label}] ${JSON.stringify(f.counts)}`);
    console.log(`  [${label}] supported ${(f.supportedRate * 100).toFixed(1)}% of judged`);
  };
  printFaithfulness("answerable", m.faithfulness.answerable);
  printFaithfulness("unanswerable", m.faithfulness.unanswerable);
  printFaithfulness("combined", m.faithfulness.combined);
  console.log(`  CONTRADICTED ${m.faithfulness.combined.counts.contradicted} — this is the count that must be zero`);
  console.log(`\n  claims dropped by verifyClaims across all answers: ${m.droppedClaims}`);

  // Samples per verdict, so the RUBRIC can be audited and not just the totals.
  //
  // The first smoke run returned `overstated` as the second-largest bucket, and that bucket is
  // where this instrument is most likely to measure itself rather than the product: the ask
  // prompt demands "plain language a non-lawyer understands", and plain language drops
  // qualifiers by nature, which is close to the rubric's definition of overstated. Whether
  // those are real defects or the judge penalising the product for doing what it was told is
  // not decidable from a count — it needs rows. Same discipline as publishing all 15 declines
  // in the anchor-signals report: an aggregate nobody can check is not evidence.
  //
  // Costs nothing: every verdict is already in `records`.
  const SAMPLES_PER_VERDICT = 3;
  const byVerdict = new Map<string, string[]>();
  for (const r of records) {
    for (const cl of r.claims) {
      const key = cl.verdict ?? "unparsed";
      const bucket = byVerdict.get(key) ?? [];
      if (bucket.length >= SAMPLES_PER_VERDICT) continue;
      const para = (byId.get(r.caseId)?.chunks ?? []).find((ch) => ch.paragraph === cl.sourceParagraph);
      bucket.push(
        `${r.kind === "answerable" ? "A" : "U"} ${r.caseId} ${cl.sourceParagraph}\n` +
        `        claim: ${JSON.stringify(cl.text)}\n` +
        `        para:  ${JSON.stringify((para?.text ?? "<absent>").slice(0, 260))}`);
      byVerdict.set(key, bucket);
    }
  }
  console.log(`\n--- samples per verdict (A = answerable, U = unanswerable) ---`);
  for (const v of ["contradicted", "unrelated", "overstated", "supported", "unparsed"]) {
    const rows = byVerdict.get(v);
    if (!rows?.length) continue;
    console.log(`\n  ### ${v}`);
    for (const row of rows) console.log(`  - ${row}`);
  }
}
main().catch((e) => { console.error("❌ cases-caseqa-eval failed:", e instanceof Error ? e.message : String(e)); process.exit(1); });
