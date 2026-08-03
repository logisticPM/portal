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
import { pickTargets, buildQuestionPrompt, isLexicalGimme } from "../src/lib/cases/caseqa-eval/construct";
import { buildFaithfulnessPrompt, parseVerdict, buildAddressedPrompt, parseAddressed } from "../src/lib/cases/caseqa-eval/judge";
import { score, type EvalRecord, type ClaimRecord } from "../src/lib/cases/caseqa-eval/metrics";
import { assertDistinctModels, formatProvenance } from "../src/lib/cases/caseqa-eval/guards";

const SEED = Number(process.env.EVAL_SEED ?? 1);
const N_ANSWERABLE = Number(process.env.EVAL_ANSWERABLE ?? 40);
const N_UNANSWERABLE = Number(process.env.EVAL_UNANSWERABLE ?? 20);

const WRITER = process.env.EVAL_WRITER_MODEL ?? "us.anthropic.claude-3-5-sonnet-20241022-v2:0";
const ANSWERER = process.env.EVAL_ANSWER_MODEL ?? "us.meta.llama3-3-70b-instruct-v1:0";
const JUDGE = process.env.EVAL_JUDGE_MODEL ?? "us.anthropic.claude-3-7-sonnet-20250219-v1:0";

async function main() {
  // Guard 1 (spec §7), in guards.ts so it has a test.
  assertDistinctModels({ writer: WRITER, answerer: ANSWERER, judge: JUDGE });
  // Construction and judging are cached so re-running after an ANSWERER change replays the
  // same questions and the same verdicts. The answerer is deliberately uncached — it is the
  // thing under measurement.
  const writer = cachedModel(modelFromId(WRITER));
  const judge = cachedModel(modelFromId(JUDGE));
  const answerer = modelFromId(ANSWERER);

  const profiles = await dynamoCaseRepo.listCases({ tier: "core" });
  const cases = [];
  for (const p of profiles) {
    const c = await dynamoCaseRepo.getCase(p.id);
    if (c?.chunks?.length) cases.push(c);
  }
  // Guard 3: an empty population is an error. cases-eval.ts printed a full scorecard of
  // zeros and exited 0 on 2026-08-02.
  if (!cases.length) throw new Error("no core case has chunks — this run would measure nothing");

  const targets = pickTargets(cases, SEED, N_ANSWERABLE);
  const byId = new Map(cases.map((c) => [c.id, c]));

  // --- construct questions -------------------------------------------------------
  let gimmes = 0, writerFails = 0;
  const built: { caseId: string; qid: string; question: string; targetParagraph: string }[] = [];
  for (const t of targets) {
    const c = byId.get(t.caseId)!;
    const question = (await writer.call(buildQuestionPrompt(c, t))).trim();
    if (!question) { writerFails++; continue; }
    // Guard 2: a verbatim run would let the retriever win on string overlap.
    if (isLexicalGimme(question, t.text)) { gimmes++; continue; }
    built.push({ caseId: t.caseId, qid: `ans-${built.length + 1}`, question, targetParagraph: t.paragraph });
  }
  if (!built.length) throw new Error("every constructed question was rejected — nothing to measure");

  // --- pair unanswerables, then VALIDATE them (spec §5) --------------------------
  let discardedPairs = 0, addressedFails = 0;
  const pairs: { caseId: string; qid: string; question: string }[] = [];
  for (const b of built.slice(0, N_UNANSWERABLE)) {
    const other = built.find((x) => x.caseId !== b.caseId && !pairs.some((p) => p.caseId === x.caseId));
    if (!other) continue;
    const target = byId.get(other.caseId)!;
    const raw = await judge.call(buildAddressedPrompt(b.question, target.styleOfCause,
      assembleInput(target.chunks!, target.outcome.holding)));
    const addressed = parseAddressed(raw);
    // Unparseable or genuinely addressed: DISCARD, do not count as either bucket.
    // Counting an addressed pair as unanswerable would inflate false-answer rate with
    // correct answers.
    if (addressed === null) { addressedFails++; discardedPairs++; continue; }
    if (addressed) { discardedPairs++; continue; }
    pairs.push({ caseId: other.caseId, qid: `un-${pairs.length + 1}`, question: b.question });
  }

  // --- ask the product, then judge each published claim --------------------------
  const judgeClaims = async (c: { chunks?: { paragraph: string; text: string }[] }, claims: { text: string; sourceParagraph: string }[]) => {
    const out: ClaimRecord[] = [];
    for (const cl of claims) {
      const para = (c.chunks ?? []).find((ch) => ch.paragraph === cl.sourceParagraph);
      // An anchor pointing at a paragraph that is not in chunks would be a product bug,
      // not a faithfulness question. Surface it rather than scoring it.
      if (!para) throw new Error(`anchor cites ${cl.sourceParagraph}, absent from chunks`);
      out.push({ text: cl.text, sourceParagraph: cl.sourceParagraph,
        verdict: parseVerdict(await judge.call(buildFaithfulnessPrompt(cl.text, para.text))) });
    }
    return out;
  };

  const records: EvalRecord[] = [];
  for (const b of built) {
    const c = byId.get(b.caseId)!;
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
    casesWithChunks: cases.length, targets: targets.length,
    built: built.length, gimmes, writerFails,
    pairs: pairs.length, discardedPairs, addressedFails,
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
    const med = os[Math.floor(os.length / 2)];
    console.log(`  unverifiable bestOverlap (n=${os.length}): min ${os[0].toFixed(2)}` +
      ` · median ${med.toFixed(2)} · max ${os[os.length - 1].toFixed(2)}`);
  }

  console.log(`\n--- unanswerable (cross-case; correct behaviour is refusal) ---`);
  console.log(`  attempted ${m.unanswerable.attempted} · answered ${m.unanswerable.answered}` +
    ` · refused ${m.unanswerable.refused} · errored ${m.unanswerable.errored}`);
  console.log(`  false-answer rate    ${(m.unanswerable.falseAnswerRate * 100).toFixed(1)}%`);
  console.log(`  failKinds ${JSON.stringify(m.unanswerable.failKinds)}`);

  console.log(`\n--- faithfulness (LLM-judged, against the cited paragraph) ---`);
  console.log(`  judged ${m.faithfulness.judged} claims · unparsed verdicts ${m.faithfulness.unparsed}`);
  console.log(`  ${JSON.stringify(m.faithfulness.counts)}`);
  console.log(`  supported ${(m.faithfulness.supportedRate * 100).toFixed(1)}% of judged`);
  console.log(`  CONTRADICTED ${m.faithfulness.counts.contradicted} — this is the count that must be zero`);
  console.log(`\n  claims dropped by verifyClaims across all answers: ${m.droppedClaims}`);
}
main().catch((e) => { console.error("❌ cases-caseqa-eval failed:", e instanceof Error ? e.message : String(e)); process.exit(1); });
