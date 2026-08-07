// Two-arm measurement of the sufficiency rater (spec 2026-08-07). Phase 1: measurement only —
// this changes NOTHING in the product. Wiring is conditional on the pre-registered thresholds in
// sufficiency/tally.ts and is not in this script.
//
// Run: AWS_PROFILE=bedrock npm run cases:sufficiency-eval:cloud
//
//   arm S  answerable questions, full body      — ground truth SUFFICIENT by construction
//   arm X  cross-case unanswerable, full body   — INSUFFICIENT per an LLM screen
//
// There was a third arm. Arm L took arm S's questions and deleted the target paragraph, so that
// insufficiency would be created by construction rather than certified by a screen. It was
// measured and it does not work on this corpus: after the deletion an independent model still
// judged the question answerable 33/38 = 86.8% of the time, because judgments restate the same
// proposition across paragraphs. Its ground truth was wrong for six of every seven items, so it
// was deleted rather than left to look like evidence. See
// docs/research/2026-08-07-sufficient-context-results.md.
//
// Arm X's labels came from a screen run on the JUDGE model, so a rater that is also the judge
// would be scoring its own homework — hence the role guard below.
import "./fetch-polyfill";
import { promises as fs } from "node:fs";
import path from "node:path";
import { dynamoCaseRepo } from "../src/lib/cases/repo.dynamo";
import { modelFromId, cachedModel, hasCached, evictCached } from "../src/lib/cases/ingest/llm";
import { assembleInput } from "../src/lib/cases/ingest/summarizer";
import { buildSufficiencyPrompt, parseSufficiency, type Sufficiency } from "../src/lib/cases/sufficiency/prompt";
import {
  falseRefusalRate, projectedFalseAnswerRate, decide, assertNoCallFailures,
  FALSE_REFUSAL_MAX, PROJECTED_FALSE_ANSWER_MAX, BASELINE_FALSE_ANSWER, type ArmCounts,
} from "../src/lib/cases/sufficiency/tally";
import { callParsed, type CacheOps } from "../src/lib/cases/nli-probe/repair";
import { pickTargets, buildQuestionPrompt, isWellFormedQuestion, isLexicalGimme } from "../src/lib/cases/caseqa-eval/construct";
import { screenSubstantiveTargets } from "../src/lib/cases/caseqa-eval/substanceScreen";
import { buildUnanswerablePairs } from "../src/lib/cases/caseqa-eval/pairing";
import { buildSubstantivePrompt, parseSubstantive, buildAddressedPrompt, parseAddressed } from "../src/lib/cases/caseqa-eval/judge";

// Four roles, no model may hold two (spec §5). RATER must differ from all three; the runner
// refuses to start otherwise, because a rater that is also the judge scores arm X against labels
// it produced itself, and that agreement would be reported as accuracy.
// Names deliberately identical to cases-caseqa-eval.ts's. Both runners must construct the SAME
// questions, so an operator who overrides a role for one and not the other would break the
// premise the construction cross-check exists to protect — while the override silently appeared
// to work.
const WRITER = process.env.EVAL_WRITER_MODEL ?? "us.anthropic.claude-sonnet-4-6";
const JUDGE = process.env.EVAL_JUDGE_MODEL ?? "us.anthropic.claude-opus-4-5-20251101-v1:0";
const ANSWERER = process.env.EVAL_ANSWER_MODEL ?? "us.meta.llama3-3-70b-instruct-v1:0";
const RATER = process.env.SUFFICIENCY_RATER ?? "us.anthropic.claude-sonnet-4-6";

// Budgets explicit. #237 lost a whole arm to maxTokens 64: "output STRICTLY this JSON" does not
// stop a model reasoning in prose first, a response truncated mid-reasoning still has a text
// part so llm.ts does not throw, and the label silently fails to parse — non-randomly, skewed
// toward the hard cases. This prompt asks for reasoning FIRST, so it needs room for it.
const RATER_MAX_TOKENS = 1024;
const WRITER_MAX_TOKENS = 512;
const JUDGE_MAX_TOKENS = 1024;

const SEED = Number(process.env.EVAL_SEED ?? 1);
const N_ANSWERABLE = Number(process.env.EVAL_ANSWERABLE ?? 40);
const N_UNANSWERABLE = Number(process.env.EVAL_UNANSWERABLE ?? 20);

let repairs = 0;
const CACHE_OPS: CacheOps = { hasCached, evictCached };

async function main() {
  // Spec §5's fallback: if no fourth id is invocable, the rater may share the WRITER's id and
  // the report carries a contamination caveat (the rater would be grading questions its own
  // family wrote). Sharing the JUDGE's id is never allowed under any flag — the judge produced
  // arm X's labels, so that pairing turns arm X into self-agreement, which is the one result
  // this whole design exists to avoid.
  const shared = new Set([WRITER, JUDGE, ANSWERER, RATER]).size !== 4;
  const allowShared = process.env.SUFFICIENCY_ALLOW_SHARED === "1";
  if (RATER === JUDGE) {
    throw new Error(
      `rater must not be the judge (${JUDGE}): the judge produced arm X's "does not address" ` +
      `labels, so scoring the rater against them would measure self-agreement and report it as ` +
      `accuracy. No flag overrides this. Run 'npm run cases:probe-models:cloud' and set SUFFICIENCY_RATER.`,
    );
  }
  if (shared && !allowShared) {
    throw new Error(
      `four roles must be four DIFFERENT models, got writer=${WRITER} judge=${JUDGE} ` +
      `answerer=${ANSWERER} rater=${RATER}. Run 'npm run cases:probe-models:cloud' to find a ` +
      `fourth invocable id and set SUFFICIENCY_RATER. If none exists, re-run with ` +
      `SUFFICIENCY_ALLOW_SHARED=1 — arm X stays clean, but arm S carries a ` +
      `writer-contamination caveat that MUST appear in the findings doc.`,
    );
  }
  if (shared) {
    // Name the actual collision. `shared` is true for ANY duplicate among the four, and the
    // caveat differs by which: rater==writer contaminates arm S (the rater grades questions its
    // own family wrote), while any other collision means something else entirely.
    const roles = { writer: WRITER, judge: JUDGE, answerer: ANSWERER, rater: RATER };
    const collisions = Object.entries(roles)
      .filter(([r]) => r !== "rater").filter(([, id]) => id === RATER).map(([r]) => r);
    console.warn(`⚠ CONTAMINATED RUN: rater shares an id with ${collisions.join(" and ")} (${RATER}). This caveat MUST appear in the findings doc.\n`);
  }

  const writer = cachedModel(modelFromId(WRITER, { maxTokens: WRITER_MAX_TOKENS }));
  const judge = cachedModel(modelFromId(JUDGE, { maxTokens: JUDGE_MAX_TOKENS }));
  const rater = cachedModel(modelFromId(RATER, { maxTokens: RATER_MAX_TOKENS }));

  let callFailures = 0;
  const rate = async (question: string, styleOfCause: string, body: string): Promise<Sufficiency | null> => {
    try {
      const { value, repaired } = await callParsed(
        rater, buildSufficiencyPrompt(question, styleOfCause, body), parseSufficiency, CACHE_OPS);
      if (repaired) repairs++;
      return value;
    } catch (e) {
      callFailures++;
      console.warn("  [rater failed]", e instanceof Error ? e.message : String(e));
      return null;
    }
  };

  // --- construction: the SAME modules the answer-quality eval uses ------------------------
  // Not a copy of its logic — these are the shared, unit-tested modules it imports. Same seed
  // and the same warm cache reproduce the same question set; step 2 below verifies that against
  // the persisted rows rather than assuming it.
  // Exactly how cases-caseqa-eval.ts loads them: listCases returns PROFILES, which carry no
  // chunks, so each one has to be fetched individually. Filtering `corpusTier`/`chunks` off the
  // profile list instead would silently yield an empty population.
  const profiles = await dynamoCaseRepo.listCases({ tier: "core" });
  const cases = [];
  for (const p of profiles) {
    const c = await dynamoCaseRepo.getCase(p.id);
    if (c?.chunks?.length) cases.push(c);
  }
  if (!cases.length) throw new Error("no core case has chunks — this run would measure nothing");
  const byId = new Map(cases.map((c) => [c.id, c]));

  const { targets: shaped } = pickTargets(cases, SEED, N_ANSWERABLE);
  const { targets, targetsRejectedByJudge, targetJudgeUnparsed } = await screenSubstantiveTargets(shaped, async (t) =>
    parseSubstantive(await judge.call(buildSubstantivePrompt(t.text, byId.get(t.caseId)!.styleOfCause))));
  if (!targets.length) throw new Error("no eligible target survived — run the answer-quality eval first to warm the cache");

  // Rejections counted apart from one another, not collapsed into a bare `continue`. The
  // imported modules already compute these, and the first version of this runner destructured
  // only the survivors and dropped them. That is the #237 failure mode one step upstream: if the
  // writer starts truncating or the judge starts returning unparseable screens, the measured
  // population silently shrinks and nothing in the output says why.
  let writerFails = 0, writerMalformed = 0, gimmes = 0;
  const built: { caseId: string; qid: string; question: string; targetParagraph: string }[] = [];
  for (const t of targets) {
    const c = byId.get(t.caseId)!;
    const question = (await writer.call(buildQuestionPrompt(c, t))).trim();
    if (!question) { writerFails++; continue; }
    if (!isWellFormedQuestion(question)) { writerMalformed++; continue; }
    if (isLexicalGimme(question, t.text)) { gimmes++; continue; }
    built.push({ caseId: t.caseId, qid: `ans-${built.length + 1}`, question, targetParagraph: t.paragraph });
  }
  const { pairs, discardedPairs, addressedFails, exhausted } = await buildUnanswerablePairs(built, N_UNANSWERABLE, SEED, async (source, candidate) => {
    const target = byId.get(candidate.caseId)!;
    return parseAddressed(await judge.call(buildAddressedPrompt(source.question, target.styleOfCause,
      assembleInput(target.chunks!, target.outcome.holding))));
  });
  console.log(`construction: ${built.length} answerable · ${pairs.length} unanswerable (seed ${SEED})`);
  console.log(`  target attrition: rejected by substance screen ${targetsRejectedByJudge} · unparseable screen ${targetJudgeUnparsed}`);
  console.log(`  question attrition: writer empty ${writerFails} · malformed ${writerMalformed} · lexical gimme ${gimmes}`);
  console.log(`  pairing attrition: discarded ${discardedPairs} · addressed-screen unparsed ${addressedFails} · candidates exhausted ${exhausted}`);
  console.log(`models: writer ${WRITER} · judge ${JUDGE} · answerer ${ANSWERER} · RATER ${RATER}\n`);

  // --- cross-check construction against a prior run ---------------------------------------
  // What this CAN establish: construction is reproducible — same seed, same cached writer and
  // judge, same questions out.
  //
  // What it CANNOT establish, and what an earlier draft of this block wrongly told the operator
  // it had: that these are the questions the 93.8% baseline was measured on. That baseline is
  // the 2026-08-06 run, which persisted NO rows — its 266 judged claims were unrecoverable, and
  // fixing that is the reason row persistence exists at all. Every file on disk is therefore
  // from a LATER run. Printing "the baseline does not apply" on mismatch implied the converse
  // on match, which was a claim this check is structurally unable to make.
  const rowsDir = path.join(process.cwd(), "scripts", ".cache", "eval-rows");
  let crossCheck = "not run";
  let drift: string | null = null;
  try {
    const files = (await fs.readdir(rowsDir)).filter((f) => f.endsWith(".jsonl") && !f.endsWith(".nli.jsonl")).sort();
    const latest = files[files.length - 1];
    if (!latest) {
      crossCheck = "no prior eval rows on disk — construction NOT cross-checked";
    } else {
      const lines = (await fs.readFile(path.join(rowsDir, latest), "utf8")).trim().split("\n").map((l) => JSON.parse(l));
      const header = lines.find((r) => r.kind === "run");
      // A prior run at a different seed draws different targets, so every qid names a different
      // question and EVERY comparison reports drift. That is a mismatched reference, not a
      // regression — and a check that cries wolf is a check the operator learns to ignore.
      if (header && header.seed !== SEED) {
        crossCheck = `prior rows ${latest} are seed ${header.seed}, this run is seed ${SEED} — not comparable, NOT cross-checked`;
      } else {
        const prior = new Map<string, string>();
        for (const r of lines) if (r.kind === "claim" && r.question) prior.set(r.qid, r.question);
        let checked = 0;
        for (const q of [...built, ...pairs]) {
          const was = prior.get(q.qid);
          if (was === undefined) continue;
          if (was !== q.question) {
            drift = `construction drift: ${q.qid} was "${was.slice(0, 60)}..." in ${latest}, now "${q.question.slice(0, 60)}..."`;
            break;
          }
          checked++;
        }
        // Zero overlap is NOT a pass. A prior file whose claim rows predate the `question` field,
        // or a run in which every question was refused (a refused question produces no claim
        // rows), leaves checked at 0 — which the previous version printed as a match count,
        // reading exactly like success.
        crossCheck = checked > 0
          ? `${checked} qid(s) matched against ${latest} — construction is reproducible (NOT a check against the 93.8% baseline; that run persisted no rows)`
          : `0 qid(s) overlapped with ${latest} — construction NOT cross-checked`;
      }
    }
  } catch (e) {
    crossCheck = `skipped (${e instanceof Error ? e.message : String(e)})`;
  }
  // Thrown outside the try, via a flag rather than by re-matching the message text. The previous
  // version re-threw on `message.startsWith("construction drift")`, so rewording the operator's
  // error would have silently downgraded a hard abort into a warning.
  if (drift) throw new Error(`${drift} — construction is not reproducible, so no cross-run comparison in this report is valid`);
  console.log(`construction cross-check: ${crossCheck}\n`);

  // --- arms -------------------------------------------------------------------------------
  const rows: string[] = [];
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const score = async (
    label: "S" | "X" | "L",
    items: { caseId: string; qid: string; question: string; body: string; targetParagraph?: string }[],
  ): Promise<{ counts: ArmCounts; unparsed: number; failed: number }> => {
    const counts: ArmCounts = { sufficient: 0, insufficient: 0 };
    let unparsed = 0, failed = 0;
    process.stdout.write(`arm ${label} (${items.length}): `);
    for (const [i, it] of items.entries()) {
      const c = byId.get(it.caseId)!;
      // `rate` returns null for BOTH a parse failure and a call failure, and those are not the
      // same thing: an unparsed response is evidence about the rater, a failed call is evidence
      // about nothing. Distinguished by whether the shared counter moved, so the line printed
      // just before assertNoCallFailures aborts does not mislabel an outage as parse failures.
      const failedBefore = callFailures;
      const v = await rate(it.question, c.styleOfCause, it.body);
      if (v === null) { if (callFailures > failedBefore) failed++; else unparsed++; continue; }
      if (v.sufficient) counts.sufficient++; else counts.insufficient++;
      rows.push(JSON.stringify({ kind: "rating", runId, arm: label, caseId: it.caseId, qid: it.qid,
        question: it.question, targetParagraph: it.targetParagraph ?? null,
        sufficient: v.sufficient, reason: v.reason }));
      if ((i + 1) % 10 === 0) process.stdout.write(`${i + 1} `);
    }
    console.log(`done (${counts.sufficient} sufficient, ${counts.insufficient} insufficient, ${unparsed} unparsed, ${failed} call failures)`);
    return { counts, unparsed, failed };
  };

  // Arm S. The budget guard is FIX D from the answer-quality eval: assembleInput drops chunks
  // over 240,000 chars, so on a very long judgment the by-construction target can be absent from
  // the body the rater sees — which would score as a rater error when the cause is upstream.
  const armSItems: { caseId: string; qid: string; question: string; body: string; targetParagraph: string }[] = [];
  let targetDroppedByBudget = 0;
  for (const b of built) {
    const c = byId.get(b.caseId)!;
    const body = assembleInput(c.chunks!, c.outcome.holding);
    if (!body.includes(`[para ${b.targetParagraph}]`)) { targetDroppedByBudget++; continue; }
    armSItems.push({ ...b, body });
  }
  if (targetDroppedByBudget) console.log(`(${targetDroppedByBudget} answerable question(s) skipped: target dropped by the assembly budget)`);
  const S = await score("S", armSItems);
  assertNoCallFailures(callFailures, "arm S");

  // Arm X.
  const armXItems = pairs.map((p) => {
    const c = byId.get(p.caseId)!;
    return { ...p, body: assembleInput(c.chunks!, c.outcome.holding) };
  });
  const X = await score("X", armXItems);
  assertNoCallFailures(callFailures, "arm X");

  // --- report -----------------------------------------------------------------------------
  const fr = falseRefusalRate(S.counts);
  const pfa = projectedFalseAnswerRate(X.counts);
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  console.log(`\n--- arm S (answerable, SUFFICIENT by construction) ---`);
  console.log(`  false refusal: ${S.counts.insufficient}/${S.counts.sufficient + S.counts.insufficient} = ${pct(fr)}   (max ${pct(FALSE_REFUSAL_MAX)})`);
  console.log(`--- arm X (cross-case, INSUFFICIENT per an LLM screen) ---`);
  console.log(`  projected false answer: ${X.counts.sufficient}/${X.counts.sufficient + X.counts.insufficient} = ${pct(pfa)}   (max ${pct(PROJECTED_FALSE_ANSWER_MAX)}, baseline ${pct(BASELINE_FALSE_ANSWER)})`);
  console.log(`\n  unparsed ratings: S ${S.unparsed} · X ${X.unparsed}`);
  console.log(`  cache entries evicted and re-fetched: ${repairs}`);
  console.log(`\n--- pre-registered decision ---`);
  console.log(`  VERDICT: ${decide(fr, pfa).toUpperCase()}`);

  const outDir = path.join(process.cwd(), "scripts", ".cache", "sufficiency-rows");
  await fs.mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, `${runId}.jsonl`);
  await fs.writeFile(outFile, [
    // `contaminated` travels with the rows, not just the console: a findings doc written weeks
    // later from the JSONL must not be able to lose the caveat.
    JSON.stringify({ kind: "run", runId, writer: WRITER, judge: JUDGE, answerer: ANSWERER, rater: RATER,
      contaminated: shared, seed: SEED, armS: S.counts, armX: X.counts,
      falseRefusal: fr, projectedFalseAnswer: pfa, decision: decide(fr, pfa),
      // Attrition travels with the rows for the same reason `contaminated` does. Without these,
      // a findings doc written weeks later from the JSONL alone cannot tell whether
      // falseRefusal 0.03 came from 38 of 38 questions rated or 38 of 60.
      unparsed: { S: S.unparsed, X: X.unparsed },
      callFailures: { S: S.failed, X: X.failed },
      targetDroppedByBudget, crossCheck,
      construction: { targetsRejectedByJudge, targetJudgeUnparsed, writerFails, writerMalformed, gimmes,
        discardedPairs, addressedFails, exhausted } }),
    ...rows,
  ].join("\n") + "\n", "utf8");
  console.log(`\nrows -> ${outFile}`);

  // NOT an independent reconciliation, despite what an earlier comment here claimed. In `score`
  // the counter increment and the `rows.push` are unconditionally adjacent with no branch
  // between them, so `rows.length` equals the tally BY CONSTRUCTION and this can never fire
  // today. It is kept as a tripwire for a FUTURE edit that inserts an early exit between those
  // two lines — which is a real risk and worth a cheap guard — but it must not be read as
  // evidence that the two were derived independently. This project has shipped genuinely
  // unreachable assertions before by re-deriving a check from the branch that assigned the
  // value; the difference here is that the limitation is stated rather than disguised.
  const persisted = rows.length;
  const tallied = S.counts.sufficient + S.counts.insufficient + X.counts.sufficient
    + X.counts.insufficient;
  if (persisted !== tallied) throw new Error(`persisted ${persisted} rows but tallied ${tallied} ratings`);
}

main().catch((e) => { console.error(e); process.exit(1); });
