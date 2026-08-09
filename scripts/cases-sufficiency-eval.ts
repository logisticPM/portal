// Two-arm measurement of the sufficiency rater (spec 2026-08-07). Phase 1: measurement only —
// this changes NOTHING in the product. Wiring is conditional on the pre-registered thresholds in
// sufficiency/tally.ts and is not in this script.
//
//   arm S  answerable questions, full body      — ground truth SUFFICIENT by construction
//   arm X  cross-case unanswerable, full body   — INSUFFICIENT per an LLM screen
//
// Two modes, selected by SUFFICIENCY_MODE (default "dev"):
//   dev   runs the whole pre-registered grid (spec §5) — every STAGE1_RATERS id at prompt P0,
//         then P1/P2 at whichever rater won stage 1 — prints each configuration's rates, and
//         names the winner under the pre-registered selection rule (sufficiency/tally.ts's
//         selectOnDev).
//   test  runs exactly ONE named configuration (SUFFICIENCY_CONFIG=<variant>/<rater>), once,
//         against the held-out test split, and appends the result to an append-only manifest
//         (sufficiency/manifest.ts) so a later reader can see how many times test has been run.
//
// The two modes must never disagree about which questions are "dev" and which are "test": both
// recompute the split from the same seed (sufficiency/split.ts's splitDevTest) in SEPARATE
// processes. If they ever disagreed, the "held-out" test set would silently contain questions
// the dev-mode tuning already saw, and no rate reported by test mode would mean what it says.
//
// Run: AWS_PROFILE=bedrock npm run cases:sufficiency-eval:cloud
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
import { parseSufficiency } from "../src/lib/cases/sufficiency/prompt";
import {
  falseRefusalRate, projectedFalseAnswerRate, decide, assertNoCallFailures,
  FALSE_REFUSAL_MAX, PROJECTED_FALSE_ANSWER_MAX, BASELINE_FALSE_ANSWER, type ArmCounts,
} from "../src/lib/cases/sufficiency/tally";
import { VARIANTS, VARIANT_IDS, type VariantId } from "../src/lib/cases/sufficiency/prompt";
import { splitDevTest, assertDisjoint, isDevHeader } from "../src/lib/cases/sufficiency/split";
import { wilson, classify, selectOnDev, type DevResult } from "../src/lib/cases/sufficiency/tally";
import { readTestRuns, appendTestRun } from "../src/lib/cases/sufficiency/manifest";
import { retryingModel } from "../src/lib/cases/sufficiency/retrying";
import { callParsed, type CacheOps } from "../src/lib/cases/nli-probe/repair";
import { pickTargets, buildQuestionPrompt, isWellFormedQuestion, isLexicalGimme, MIN_TARGET_PARA_CHARS, isProseShaped } from "../src/lib/cases/caseqa-eval/construct";
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
// Budgets explicit. #237 lost a whole arm to maxTokens 64: "output STRICTLY this JSON" does not
// stop a model reasoning in prose first, a response truncated mid-reasoning still has a text
// part so llm.ts does not throw, and the label silently fails to parse — non-randomly, skewed
// toward the hard cases. This prompt asks for reasoning FIRST, so it needs room for it.
const RATER_MAX_TOKENS = 1024;
const WRITER_MAX_TOKENS = 512;
const JUDGE_MAX_TOKENS = 1024;

const SEED = Number(process.env.EVAL_SEED ?? 1);
// Sized by what a 5% bar can be measured against, not by round numbers (spec §3): n=73 is the
// smallest arm-S test set where a perfect result clears a 5% Wilson upper bound. At 80, zero
// refusals gives 4.6% and clears; ONE gives 6.7% and does not.
const N_ANSWERABLE = Number(process.env.EVAL_ANSWERABLE ?? 120);
const N_UNANSWERABLE = Number(process.env.EVAL_UNANSWERABLE ?? 60);
const DEV_ANSWERABLE = Number(process.env.SUFFICIENCY_DEV_ANSWERABLE ?? 40);
const DEV_UNANSWERABLE = Number(process.env.SUFFICIENCY_DEV_UNANSWERABLE ?? 20);
// The smallest arm-S size at which 0 refusals gives a Wilson upper bound at or under 5%
// (spec §3). Below this the experiment cannot clear its own bar even with a perfect result.
const ARM_S_FLOOR = 73;

const MODE = process.env.SUFFICIENCY_MODE ?? "dev";

// The grid, pre-registered (spec §5). Not "until something passes".
//
// us.deepseek.r1-v1:0 is invocable and deliberately excluded: it is a reasoning model, this
// prompt already asks for reasoning before the label, and that combination is the
// budget-starvation shape that cost #237 an entire arm.
// AMENDED 2026-08-07, and the amendment is a deviation from pre-registration that must be
// disclosed in any report built on this run. `cohere.command-r-plus-v1:0` was in the registered
// grid and has been removed: the provider now refuses it with
//
//   Access denied. This Model is marked by provider as Legacy and you have not been actively
//   using the model in the last 30 days. Please upgrade to an active model on Amazon Bedrock
//
// It produced ZERO ratings — all 59 of its calls were denied — so dropping it cannot shift the
// selection toward or away from any result. That is the only reason this is defensible: a model
// removed because we disliked its numbers would invalidate the experiment.
//
// It also falsifies an assumption in cases-probe-models.ts. That script exists because
// `list-inference-profiles` reporting ACTIVE does not mean invocable; this shows that invocable
// *at probe time* does not mean invocable later either. The probe said INVOCABLE for this id a
// few hours before these 59 denials. A grid should be re-probed immediately before a paid run,
// not once at the start of the project.
const STAGE1_RATERS = [
  "us.amazon.nova-pro-v1:0",
  "us.meta.llama4-maverick-17b-instruct-v1:0",
  "us.amazon.nova-lite-v1:0",
];
const STAGE2_VARIANTS: VariantId[] = ["P1", "P2"];

let repairs = 0;
let retries = 0;
const CACHE_OPS: CacheOps = { hasCached, evictCached };

async function main() {
  // Role separation, now against every rater in the grid rather than one. A rater that is also
  // the judge would be scored against arm X labels the judge itself produced; one that is the
  // writer wrote arm S's questions; one that is the answerer is the subject under test.
  //
  // The #239 `SUFFICIENCY_ALLOW_SHARED` escape hatch is gone. It existed because only three
  // invocable ids were known; the probe has since found eight, so a contaminated run is no
  // longer a necessary compromise and the flag would only be a way to make one by accident.
  for (const r of STAGE1_RATERS) {
    if (r === JUDGE) throw new Error(`grid contains the judge (${JUDGE}) as a rater — that scores it against its own arm-X labels`);
    if (r === WRITER) throw new Error(`grid contains the writer (${WRITER}) as a rater — it wrote arm S's questions`);
    if (r === ANSWERER) throw new Error(`grid contains the answerer (${ANSWERER}) as a rater — it is the subject under test`);
  }
  if (new Set(STAGE1_RATERS).size !== STAGE1_RATERS.length) throw new Error("STAGE1_RATERS contains a duplicate");

  // Test-mode arguments are validated HERE, before the repo read, because they depend only on
  // env vars and module constants. Positioned after construction (where an earlier draft of this
  // plan put them) a typo in SUFFICIENCY_CONFIG costs a DynamoDB read and the entire construction
  // phase before the operator is told the string was malformed — and the role-clash check, which
  // is the circularity guard, would fire long after it could have.
  // Reject an unrecognised mode by name, before anything else reads it. Hoisting the test-mode
  // validation behind `MODE === "test"` introduced this: a typo like `Test` or `tset` used to
  // fall through to the config check and get a helpful message, but would now skip that block,
  // skip the dev block, and die on `testConfig!` with a raw destructuring TypeError. An
  // instrument whose whole purpose is to keep dev and test apart must not treat an unreadable
  // mode as either one.
  if (MODE !== "dev" && MODE !== "test") {
    throw new Error(`SUFFICIENCY_MODE must be "dev" or "test" — got "${MODE}". Nothing ran.`);
  }

  let testConfig: { configId: string; variant: VariantId; raterId: string } | null = null;
  if (MODE === "test") {
    const configId = process.env.SUFFICIENCY_CONFIG;
    if (!configId) {
      throw new Error(
        "SUFFICIENCY_MODE=test requires SUFFICIENCY_CONFIG=<variant>/<rater>. It is deliberately not " +
        "re-derived from dev: the operator states which configuration was chosen, and that statement " +
        "is what the manifest records.",
      );
    }
    const [variant, ...raterParts] = configId.split("/");
    const raterId = raterParts.join("/");
    if (!(VARIANT_IDS as readonly string[]).includes(variant) || !raterId) {
      throw new Error(`SUFFICIENCY_CONFIG must be <variant>/<rater>, e.g. P1/us.amazon.nova-pro-v1:0 — got "${configId}"`);
    }
    if (raterId === JUDGE || raterId === WRITER || raterId === ANSWERER) {
      throw new Error(`rater ${raterId} holds another role (judge/writer/answerer) — see the grid guard`);
    }
    // The grid is pre-registered (spec §5). Dev enforces it by construction; without this, the
    // single path that SPENDS the test set would accept any model string — including
    // us.deepseek.r1-v1:0, which the spec excludes by name. Recording it in the manifest is not
    // enough: by then the test set is gone.
    if (!STAGE1_RATERS.includes(raterId)) {
      throw new Error(
        `rater ${raterId} is not in the pre-registered grid: ${STAGE1_RATERS.join(", ")}. ` +
        `Testing a configuration the grid never contained is not the experiment that was registered.`,
      );
    }
    testConfig = { configId, variant: variant as VariantId, raterId };
  }

  const writer = cachedModel(modelFromId(WRITER, { maxTokens: WRITER_MAX_TOKENS }));
  const judge = cachedModel(modelFromId(JUDGE, { maxTokens: JUDGE_MAX_TOKENS }));

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
  // pickTargets draws at most ONE target per case, so N_ANSWERABLE questions needs N_ANSWERABLE
  // cases with an eligible paragraph. Checked BEFORE spending anything: silently drawing fewer
  // would report every rate over a smaller n than the spec sized for, and that sizing is the
  // entire argument that a 5% bar is measurable at all.
  const eligibleCases = cases.filter((c) =>
    (c.chunks ?? []).some((ch) => ch.text.length >= MIN_TARGET_PARA_CHARS && isProseShaped(ch.text))).length;
  console.log(`pool: ${cases.length} core case(s) with chunks · ${eligibleCases} with a stage-1-eligible paragraph`);
  if (eligibleCases < N_ANSWERABLE) {
    throw new Error(
      `need ${N_ANSWERABLE} eligible cases for ${N_ANSWERABLE} answerable questions (one target per case), ` +
      `have ${eligibleCases}. Lower EVAL_ANSWERABLE and re-derive the split sizes from spec §3's power ` +
      `table — do NOT keep an 80-question test target on a smaller pool, because the 5% bar stops ` +
      `being measurable.`,
    );
  }
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
  console.log(`models: writer ${WRITER} · judge ${JUDGE} · answerer ${ANSWERER}\n`);

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
      // A prior run at a different seed OR a different draw size is a mismatched reference, not
      // a regression. buildUnanswerablePairs draws its candidates from `built`, so changing
      // N_ANSWERABLE changes arm X's pairings by design — reporting that as drift would train
      // the operator to ignore the check.
      const sizeChanged = header && (header.answerable !== N_ANSWERABLE || header.unanswerable !== N_UNANSWERABLE);
      if (header && header.seed !== SEED) {
        crossCheck = `prior rows ${latest} are seed ${header.seed}, this run is seed ${SEED} — not comparable, NOT cross-checked`;
      } else if (sizeChanged) {
        crossCheck = `prior rows ${latest} drew ${header!.answerable}/${header!.unanswerable}, this run draws ${N_ANSWERABLE}/${N_UNANSWERABLE} — arm X pairings differ by design, NOT cross-checked`;
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

  // Split ONCE, before any rating. Both modes recompute it from the same seed in separate
  // processes; if they disagreed, "held out" would be false and every number in the test report
  // would be a dev number wearing a test label.
  const splitS = splitDevTest(built, SEED, DEV_ANSWERABLE);
  const splitX = splitDevTest(pairs, SEED, DEV_UNANSWERABLE);
  assertDisjoint(splitS, (q) => q.qid);
  assertDisjoint(splitX, (q) => q.qid);
  console.log(`split (seed ${SEED}): arm S dev ${splitS.dev.length} / test ${splitS.test.length} · arm X dev ${splitX.dev.length} / test ${splitX.test.length}`);
  console.log(`  dev  S: ${splitS.dev.map((q) => q.qid).join(" ")}`);
  console.log(`  test S: ${splitS.test.map((q) => q.qid).join(" ")}`);
  console.log(`  dev  X: ${splitX.dev.map((q) => q.qid).join(" ")}`);
  console.log(`  test X: ${splitX.test.map((q) => q.qid).join(" ")}\n`);

  // One retrying-and-cached model per rater id, built lazily so a grid entry never reached
  // costs nothing. Retry sits OUTERMOST — retryingModel(cachedModel(...), ...) — so a cache
  // hit returns from inside cachedCall and never reaches this wrapper's try/catch: a replayed
  // response never spends retry budget or increments `retries`.
  const raterCache = new Map<string, ReturnType<typeof cachedModel>>();
  const raterFor = (id: string) => {
    if (!raterCache.has(id)) {
      raterCache.set(id, retryingModel(cachedModel(modelFromId(id, { maxTokens: RATER_MAX_TOKENS })), {
        attempts: 5, baseDelayMs: 2000, onRetry: () => { retries++; },
      }));
    }
    return raterCache.get(id)!;
  };

  let callFailures = 0;
  const rate = async (raterId: string, variant: VariantId, question: string, styleOfCause: string, body: string) => {
    try {
      const { value, repaired } = await callParsed(
        raterFor(raterId), VARIANTS[variant](question, styleOfCause, body), parseSufficiency, CACHE_OPS);
      if (repaired) repairs++;
      return value;
    } catch (e) {
      callFailures++;
      console.warn("  [rater failed]", e instanceof Error ? e.message : String(e));
      return null;
    }
  };

  const rows: string[] = [];
  const runId = new Date().toISOString().replace(/[:.]/g, "-");

  const score = async (
    configId: string, raterId: string, variant: VariantId, arm: "S" | "X",
    items: { caseId: string; qid: string; question: string; body: string }[],
  ): Promise<{ counts: ArmCounts; unparsed: number; failed: number }> => {
    const counts: ArmCounts = { sufficient: 0, insufficient: 0 };
    let unparsed = 0, failed = 0;
    process.stdout.write(`  ${configId} arm ${arm} (${items.length}): `);
    for (const [i, it] of items.entries()) {
      const c = byId.get(it.caseId)!;
      // `rate` returns null for BOTH a parse failure and a call failure, and those are not the
      // same thing: an unparsed response is evidence about the rater, a failed call is evidence
      // about nothing.
      const failedBefore = callFailures;
      const v = await rate(raterId, variant, it.question, c.styleOfCause, it.body);
      if (v === null) { if (callFailures > failedBefore) failed++; else unparsed++; continue; }
      if (v.sufficient) counts.sufficient++; else counts.insufficient++;
      rows.push(JSON.stringify({ kind: "rating", runId, mode: MODE, configId, rater: raterId, variant,
        arm, caseId: it.caseId, qid: it.qid, question: it.question, sufficient: v.sufficient, reason: v.reason }));
      if ((i + 1) % 20 === 0) process.stdout.write(`${i + 1} `);
    }
    console.log(`done (${counts.sufficient}S ${counts.insufficient}I, ${unparsed} unparsed, ${failed} failed)`);
    return { counts, unparsed, failed };
  };

  // Bodies assembled once and indexed by qid, so either half of the split can be materialised
  // without re-assembling. The budget guard is FIX D from the answer-quality eval: assembleInput
  // drops chunks over 240,000 chars, so on a very long judgment the by-construction target can be
  // absent from the body the rater sees — which would score as a rater error when the cause is
  // upstream of it.
  const bodyOf = new Map<string, { caseId: string; qid: string; question: string; body: string }>();
  let targetDroppedByBudget = 0;
  for (const b of built) {
    const c = byId.get(b.caseId)!;
    const body = assembleInput(c.chunks!, c.outcome.holding);
    if (!body.includes(`[para ${b.targetParagraph}]`)) { targetDroppedByBudget++; continue; }
    bodyOf.set(b.qid, { caseId: b.caseId, qid: b.qid, question: b.question, body });
  }
  for (const p of pairs) {
    const c = byId.get(p.caseId)!;
    bodyOf.set(p.qid, { caseId: p.caseId, qid: p.qid, question: p.question, body: assembleInput(c.chunks!, c.outcome.holding) });
  }
  if (targetDroppedByBudget) console.log(`(${targetDroppedByBudget} answerable question(s) skipped: target dropped by the assembly budget)`);
  const itemsFor = (qs: { qid: string }[]) =>
    qs.map((q) => bodyOf.get(q.qid)).filter((x): x is NonNullable<typeof x> => x !== undefined);

  const outDir = path.join(process.cwd(), "scripts", ".cache", "sufficiency-rows");
  const persist = async (header: Record<string, unknown>) => {
    await fs.mkdir(outDir, { recursive: true });
    const outFile = path.join(outDir, `${runId}.jsonl`);
    await fs.writeFile(outFile, [
      // Attrition and the split travel with the rows. A findings doc written weeks later from
      // the JSONL alone must be able to tell whether a rate came from 80 of 80 or 80 of 120,
      // and which questions were held out.
      JSON.stringify({ ...header, seed: SEED, writer: WRITER, judge: JUDGE, answerer: ANSWERER,
        nAnswerable: N_ANSWERABLE, nUnanswerable: N_UNANSWERABLE,
        devS: splitS.dev.map((q) => q.qid), testS: splitS.test.map((q) => q.qid),
        devX: splitX.dev.map((q) => q.qid), testX: splitX.test.map((q) => q.qid),
        targetDroppedByBudget, repairs, retries, crossCheck, devSplitChecked: MODE === "test" ? devSplitChecked : null,
        construction: { targetsRejectedByJudge, targetJudgeUnparsed, writerFails, writerMalformed, gimmes,
          discardedPairs, addressedFails, exhausted } }),
      ...rows,
    ].join("\n") + "\n", "utf8");
    console.log(`\nrows -> ${outFile}`);
  };

  if (MODE === "dev") {
    // The forbidden move — picking a new configuration after seeing a test result — happens HERE,
    // in dev, not in test mode. Warning only in test mode would warn the one place the mistake
    // cannot be made.
    const priorTest = await readTestRuns(outDir);
    if (priorTest.length) {
      console.log(`⚠ THE TEST SET HAS ALREADY BEEN RUN ${priorTest.length} TIME(S):`);
      for (const p of priorTest) console.log(`    ${p.at}  ${p.configId}`);
      console.log(`  Re-tuning now and testing again is the move spec §2 pre-registers against: a\n  configuration chosen after seeing the held-out set is a dev result wearing a test label.\n`);
    }
    const devS = itemsFor(splitS.dev), devX = itemsFor(splitX.dev);
    const results: DevResult[] = [];

    console.log(`--- stage 1: ${STAGE1_RATERS.length} rater(s) at P0 ---`);
    for (const raterId of STAGE1_RATERS) {
      const configId = `P0/${raterId}`;
      const S = await score(configId, raterId, "P0", "S", devS);
      const X = await score(configId, raterId, "P0", "X", devX);
      assertNoCallFailures(callFailures, `stage 1, ${configId}`);
      results.push({ configId, armS: S.counts, armX: X.counts,
        unparsed: { S: S.unparsed, X: X.unparsed }, failed: { S: S.failed, X: X.failed } });
    }

    const stage1 = selectOnDev(results);
    console.log(`\nstage 1 winner: ${stage1.reason}`);
    if (!stage1.chosen) {
      console.log("\nno configuration cleared the leakage bar at stage 1 — stopping. The bar is not relaxed.");
      console.log(`retries: ${retries}`);
      await persist({ kind: "dev", runId, results, chosen: null, reason: stage1.reason });
      return;
    }
    // configId is `P0/<rater>` and a rater id can itself contain "/", so rejoin everything after
    // the first segment rather than taking [1].
    const winner = stage1.chosen.configId.split("/").slice(1).join("/");

    console.log(`\n--- stage 2: ${STAGE2_VARIANTS.join(", ")} at ${winner} ---`);
    for (const variant of STAGE2_VARIANTS) {
      const configId = `${variant}/${winner}`;
      const S = await score(configId, winner, variant, "S", devS);
      const X = await score(configId, winner, variant, "X", devX);
      assertNoCallFailures(callFailures, `stage 2, ${configId}`);
      results.push({ configId, armS: S.counts, armX: X.counts,
        unparsed: { S: S.unparsed, X: X.unparsed }, failed: { S: S.failed, X: X.failed } });
    }

    console.log(`\n--- all ${results.length} configuration(s) on dev ---`);
    for (const r of results) {
      const fr = falseRefusalRate(r.armS), pfa = projectedFalseAnswerRate(r.armX);
      console.log(`  ${r.configId.padEnd(48)} false refusal ${(fr * 100).toFixed(1).padStart(5)}%  leakage ${(pfa * 100).toFixed(1).padStart(5)}%`);
    }
    const final = selectOnDev(results);
    console.log(`\n--- chosen (pre-registered rule) ---\n  ${final.reason}`);
    if (final.chosen) {
      console.log(`\nRun the test set ONCE with:\n  AWS_PROFILE=bedrock SUFFICIENCY_MODE=test SUFFICIENCY_CONFIG=${final.chosen.configId} npm run cases:sufficiency-eval:cloud`);
    }
    console.log(`retries: ${retries}`);
    await persist({ kind: "dev", runId, results, chosen: final.chosen?.configId ?? null, reason: final.reason });
    return;
  }

  // --- test mode --------------------------------------------------------------------------
  // The test set can be spent once. The pre-registered rule (spec §2) is that a FAILING result
  // does not license choosing another configuration and trying again — that turns test into a
  // second dev set. This does not prevent a second run; it makes one impossible to hide.
  const { configId, variant, raterId } = testConfig!;

  const prior = await readTestRuns(outDir);
  if (prior.length) {
    console.log(`⚠ THE TEST SET HAS ALREADY BEEN RUN ${prior.length} TIME(S):`);
    for (const p of prior) {
      console.log(`    ${p.at}  ${p.configId}  arm S refused ${p.armS.insufficient}/${p.armS.sufficient + p.armS.insufficient} · arm X leaked ${p.armX.sufficient}/${p.armX.sufficient + p.armX.insufficient}`);
    }
    console.log(`  This is attempt ${prior.length + 1}. Any report MUST say so — a configuration selected by\n  re-running on the held-out set is a dev result wearing a test label.\n`);
  }

  // The dev run and this run are separate processes that each recompute the split from the same
  // seed. That is only a guarantee if the INPUT was identical: splitDevTest is Fisher-Yates over
  // indices, so both the order and the length of `built` matter, and `qid` is positional — losing
  // a single question to a writer failure or gaining one core case renumbers everything and
  // re-draws the split. Nothing else in this runner would notice; assertDisjoint cannot, because
  // two slices of one array are disjoint no matter which array it was.
  //
  // So compare against what dev actually held out, rather than trusting that the seed was enough.
  const priorDev = (await fs.readdir(outDir).catch(() => [] as string[]))
    .filter((f) => f.endsWith(".jsonl")).sort();
  let devSplitChecked = "no prior dev run on disk — SPLIT NOT VERIFIED against dev";
  let devSplitVerified = false;
  for (const f of priorDev.reverse()) {
    const first = (await fs.readFile(path.join(outDir, f), "utf8")).split("\n")[0];
    let h: Record<string, unknown>;
    try { h = JSON.parse(first); } catch { continue; }
    // `kind`, not `mode`. persist() writes `kind: "dev"` / `kind: "test"`; the first version of
    // this guard read `h.mode`, which is undefined in every row ever written, so it skipped every
    // file and reported "SPLIT NOT VERIFIED" — then spent the test set anyway. It was the fix for
    // a BLOCKING review finding and it verified nothing. isDevHeader() now owns this predicate so
    // a test can pin it against a header built the way persist() builds one.
    if (!isDevHeader(h)) continue;
    const wantS = (h.testS as string[]).join(","), gotS = splitS.test.map((q) => q.qid).join(",");
    const wantX = (h.testX as string[]).join(","), gotX = splitX.test.map((q) => q.qid).join(",");
    if (wantS !== gotS || wantX !== gotX) {
      throw new Error(
        `HELD-OUT SET DOES NOT MATCH THE DEV RUN (${f}). Construction changed between the two runs, ` +
        `so this "test" set contains questions tuning may already have seen and no number from it ` +
        `would mean what it says.\n` +
        `  dev arm S held out ${(h.testS as string[]).length}: ${wantS.slice(0, 120)}...\n` +
        `  this run computed  ${splitS.test.length}: ${gotS.slice(0, 120)}...\n` +
        `Re-run dev, or investigate what changed in the corpus.`,
      );
    }
    devSplitChecked = `matches dev run ${f} (${splitS.test.length} arm-S + ${splitX.test.length} arm-X qids identical)`;
    devSplitVerified = true;
    break;
  }
  // Not finding a dev run is FATAL, not a warning. This check is the only thing standing between
  // "held out" and "tuning already saw these", and a run that cannot confirm it is a run whose
  // headline number carries an unverifiable claim. The 2026-08-09 run printed this as a warning
  // and proceeded; the split turned out to be identical, but that was luck, not evidence.
  if (!devSplitVerified) {
    throw new Error(
      `${devSplitChecked}. Refusing to spend the test set on an unverifiable held-out claim. ` +
      `Run dev mode first (it persists testS/testX), or if this is a legacy row set, verify the ` +
      `split by hand and record that you did in the findings doc.`,
    );
  }
  console.log(`held-out split: ${devSplitChecked}\n`);
  const testS = itemsFor(splitS.test), testX = itemsFor(splitX.test);
  console.log(`--- TEST SET, ${configId} ---`);
  // Spec §3 sizes this experiment off one fact: n=73 is the smallest arm-S test set where a
  // perfect result clears a 5% upper bound. The pool guard above counts eligible CASES; what
  // reaches here is QUESTIONS, after substance-screen, writer, gimme and assembly-budget
  // attrition. #239 lost 2 of 40 that way. If the held-out arm has shrunk below the floor, the
  // run cannot answer the question it was designed to answer, and finding that out after paying
  // for it is worse than being told now.
  if (testS.length < ARM_S_FLOOR) {
    throw new Error(
      `held-out arm S has ${testS.length} questions, below the ${ARM_S_FLOOR} needed for a perfect ` +
      `result to clear a ${(FALSE_REFUSAL_MAX * 100).toFixed(0)}% upper bound (spec §3). Attrition ate ` +
      `the margin. Raise EVAL_ANSWERABLE and re-run dev — do NOT report a rate over a smaller n.`,
    );
  }
  if (testX.length === 0) throw new Error("held-out arm X is empty — nothing to measure leakage against");
  const S = await score(configId, raterId, variant as VariantId, "S", testS);
  assertNoCallFailures(callFailures, "test arm S");
  const X = await score(configId, raterId, variant as VariantId, "X", testX);
  assertNoCallFailures(callFailures, "test arm X");

  const fr = falseRefusalRate(S.counts), pfa = projectedFalseAnswerRate(X.counts);
  const nS = S.counts.sufficient + S.counts.insufficient, nX = X.counts.sufficient + X.counts.insufficient;
  const [frLo, frHi] = wilson(S.counts.insufficient, nS);
  const [pfaLo, pfaHi] = wilson(X.counts.sufficient, nX);
  const frConf = classify(S.counts.insufficient, nS, FALSE_REFUSAL_MAX);
  const pfaConf = classify(X.counts.sufficient, nX, PROJECTED_FALSE_ANSWER_MAX);
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  console.log(`\n--- result ---`);
  console.log(`  false refusal:          ${S.counts.insufficient}/${nS} = ${pct(fr)}  95% CI [${pct(frLo)}, ${pct(frHi)}]  bar ${pct(FALSE_REFUSAL_MAX)}  ${frConf}`);
  console.log(`  projected false answer: ${X.counts.sufficient}/${nX} = ${pct(pfa)}  95% CI [${pct(pfaLo)}, ${pct(pfaHi)}]  bar ${pct(PROJECTED_FALSE_ANSWER_MAX)}  ${pfaConf}`);
  console.log(`  unparsed: S ${S.unparsed} · X ${X.unparsed}   cache evictions: ${repairs} · retries: ${retries}`);
  console.log(`\n  VERDICT (point estimate, same rule as #239): ${decide(fr, pfa).toUpperCase()}`);
  console.log(`  attempt ${prior.length + 1} on the test set`);

  await appendTestRun(outDir, { configId, at: new Date().toISOString(), armS: S.counts, armX: X.counts });
  await persist({ kind: "test", runId, configId, rater: raterId, variant,
    armS: S.counts, armX: X.counts, falseRefusal: fr, projectedFalseAnswer: pfa,
    frCI: [frLo, frHi], pfaCI: [pfaLo, pfaHi], frConfidence: frConf, pfaConfidence: pfaConf,
    decision: decide(fr, pfa), attempt: prior.length + 1,
    unparsed: { S: S.unparsed, X: X.unparsed }, callFailures: { S: S.failed, X: X.failed } });

  // Kept as a tripwire for a future edit that separates the counter from the row push. NOT an
  // independent reconciliation: in `score` the two are unconditionally adjacent, so this cannot
  // fire today.
  const tallied = S.counts.sufficient + S.counts.insufficient + X.counts.sufficient + X.counts.insufficient;
  if (rows.length !== tallied) throw new Error(`persisted ${rows.length} rows but tallied ${tallied} ratings`);
}

main().catch((e) => { console.error(e); process.exit(1); });
