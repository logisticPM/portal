// Rung-3 probe: would an NLI/entailment checker have caught what the answer-quality eval's
// judge found? Reads the JSONL rows persisted by scripts/cases-caseqa-eval.ts — it does NOT
// re-run the eval. The answerer is deliberately uncached (it is the thing under test), so a
// re-run produces DIFFERENT claims and no two runs are comparable at the claim level; the
// probe must therefore attach to ONE run's persisted rows.
//
// Run: AWS_PROFILE=bedrock npm run cases:nli-probe:cloud -- <path-to-rows.jsonl>
//
// Three arms, because the natural data cannot answer the question on its own:
//   1. natural (all rows)      — the confusion matrix of judge verdict x NLI label
//   2. synthetic (n=40)        — manufactured negations of SUPPORTED claims, to get a
//                                powered recall number. CONTRADICTED is ~2% of rows by
//                                construction, so no amount of re-running fixes arm 1's
//                                bottom row. Recall here is an UPPER BOUND: a minimal
//                                lexical reversal is easier than a natural contradiction.
//   3. negative control (n=40) — the same claim against a DIFFERENT paragraph of the same
//                                case. Expected: overwhelmingly neutral. If this arm
//                                returns entailment, the checker is pattern-matching topic
//                                rather than inference and arms 1-2 measure nothing. This
//                                arm is what makes the other two interpretable.
import { promises as fs } from "node:fs";
import { modelFromId, cachedModel, hasCached, evictCached, type LlmModel } from "../src/lib/cases/ingest/llm";
import { buildNliPrompt, parseNliLabel, buildReversalPrompt, parseReversal, type NliLabel } from "../src/lib/cases/nli-probe/prompt";
import {
  emptyConfusion, addToConfusion, rowTotal, decide, formatConfusion, pct, assertNoCallFailures,
  JUDGE_VERDICTS, NLI_LABELS, FALSE_ALARM_MAX, SYNTHETIC_RECALL_MIN, type JudgeVerdict,
} from "../src/lib/cases/nli-probe/tally";
import { callParsed, type CacheOps } from "../src/lib/cases/nli-probe/repair";
import { seededShuffle } from "../src/lib/cases/caseqa-eval/rng";

// Deliberately NOT the eval judge (us.anthropic.claude-opus-4-5-*). A checker that is the
// same model as the judge would agree with itself, and the agreement would be reported as
// validation. Both ids verified invocable for this account by a real one-token Converse
// call — `list-inference-profiles` reporting ACTIVE is not the same thing.
const CHECKER = process.env.NLI_CHECKER ?? "us.anthropic.claude-sonnet-4-6";
const REVERSER = process.env.NLI_REVERSER ?? "us.anthropic.claude-sonnet-4-6";

// Budgets are explicit because this project has already lost a paid run to the maxTokens
// 256 default. The first version of THIS probe repeated the mistake at 64: "Output STRICTLY
// this JSON" does not stop the model reasoning in prose first, and a response truncated
// mid-reasoning still has a text part — so ingest/llm.ts does not throw, it returns the
// prose and the label simply fails to parse.
//
// That is worse than a crash, because the failures are not random. In the 2026-08-07 run
// 11 of 16 were judge-`overstated` and 0 of 16 were `unrelated`: the model reasons longest
// about the ambiguous cases, so truncation silently deletes the hard rows and flatters
// every rate computed on what survives. 1024 leaves room for the full derivation.
const CHECKER_MAX_TOKENS = 1024;
const REVERSER_MAX_TOKENS = 1024;

const SEED = 1;
const N_SYNTHETIC = 40;
const N_CONTROL = 40;

// Counts every cache entry this run had to throw away, so a repaired run is never mistaken
// for a clean one. Reported, not swallowed.
let repairs = 0;
const CACHE_OPS: CacheOps = { hasCached, evictCached };

// Thin wrapper over the tested decision in nli-probe/repair.ts; the only thing added here
// is the counter.
async function call1<T>(m: LlmModel, prompt: string, parse: (s: string) => T | null): Promise<T | null> {
  const { value, repaired } = await callParsed(m, prompt, parse, CACHE_OPS);
  if (repaired) repairs++;
  return value;
}

type ClaimRow = {
  kind: "claim"; runId: string; bucket: "answerable" | "unanswerable";
  caseId: string; qid: string; question: string | null;
  targetParagraph: string | null; sourceParagraph: string;
  paragraphText: string | null; text: string; verdict: JudgeVerdict | null;
};

async function main() {
  const rowsPath = process.argv[2];
  if (!rowsPath) throw new Error("usage: cases-nli-probe.ts <path-to-rows.jsonl>");
  const raw = (await fs.readFile(rowsPath, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
  const header = raw.find((r) => r.kind === "run");
  const rows: ClaimRow[] = raw.filter((r) => r.kind === "claim");

  // A row whose verdict never parsed, or whose paragraph went missing, cannot be scored
  // against anything. Dropped and REPORTED — a silent filter here would shrink the
  // denominator of every rate below without leaving a trace.
  const usable = rows.filter((r) => r.verdict !== null && r.paragraphText !== null);
  console.log(`rows: ${rows.length} read · ${usable.length} usable · ${rows.length - usable.length} dropped (no verdict or no paragraph)`);
  console.log(`source run: ${header?.runId} · answerer ${header?.answerer} · judge ${header?.judge}`);
  console.log(`checker: ${CHECKER} (deliberately NOT the judge) · reverser: ${REVERSER}`);
  console.log(`pre-registered: false-alarm <= ${(FALSE_ALARM_MAX * 100).toFixed(0)}% on supported AND synthetic recall >= ${(SYNTHETIC_RECALL_MIN * 100).toFixed(0)}%\n`);

  const checker = cachedModel(modelFromId(CHECKER, { maxTokens: CHECKER_MAX_TOKENS }));
  const reverser = cachedModel(modelFromId(REVERSER, { maxTokens: REVERSER_MAX_TOKENS }));

  // Counted apart from `unparsed` on purpose — see assertNoCallFailures in tally.ts. Still
  // caught rather than thrown at the call site so the run reaches the guard and reports how
  // many failed and why, instead of dying on the first one with a bare stack trace.
  let callFailures = 0;
  const check = async (premise: string, hypothesis: string): Promise<NliLabel | null> => {
    try { return await call1(checker, buildNliPrompt(premise, hypothesis), parseNliLabel); }
    catch (e) { callFailures++; console.warn("  [checker failed]", e instanceof Error ? e.message : String(e)); return null; }
  };

  // --- arm 1: natural ---------------------------------------------------------------
  const confusion = emptyConfusion();
  const unparsedRows: ClaimRow[] = [];
  const labelled: { row: ClaimRow; label: NliLabel }[] = [];
  process.stdout.write("arm 1 (natural): ");
  for (const [i, r] of usable.entries()) {
    const label = await check(r.paragraphText!, r.text);
    if (label === null) { unparsedRows.push(r); continue; }
    addToConfusion(confusion, r.verdict!, label);
    labelled.push({ row: r, label });
    if ((i + 1) % 25 === 0) process.stdout.write(`${i + 1} `);
  }
  const unparsed = unparsedRows.length;
  console.log(`done (${labelled.length} labelled, ${unparsed} unparsed, ${callFailures} call failures)\n`);

  // Before ANY matrix is printed. Printing first and throwing after would put a
  // "VERDICT: SHIP" on screen computed over the survivors of an outage, which is precisely
  // what the 2026-08-07 re-run did.
  assertNoCallFailures(callFailures, "arm 1 (natural)");

  // An unparsed row is a row silently deleted from every rate below, so its composition has
  // to be shown next to the composition of the corpus. In the first (maxTokens 64) run these
  // two lines diverged sharply — 69% of the failures were `overstated` against 36% of the
  // corpus — which is how the truncation bias was caught. They should now track each other.
  if (unparsed > 0) {
    const dist = (rs: { verdict: JudgeVerdict | null }[]) =>
      JUDGE_VERDICTS.map((v) => `${v} ${rs.filter((r) => r.verdict === v).length}`).join(" · ");
    console.log(`  unparsed by judge verdict: ${dist(unparsedRows)}`);
    console.log(`  corpus   by judge verdict: ${dist(usable)}`);
    console.log("  (these should have the SAME SHAPE; if the unparsed skew to one verdict, the matrix below is biased)\n");
  }

  console.log("--- arm 1: judge verdict x NLI label ---");
  console.log(formatConfusion(confusion));

  const sup = confusion.supported;
  const falseAlarm = rowTotal(sup) === 0 ? 0 : sup.contradiction / rowTotal(sup);
  const con = confusion.contradicted;
  console.log(`\n  false alarm (supported -> contradiction): ${sup.contradiction}/${rowTotal(sup)} = ${pct(sup.contradiction, rowTotal(sup))}`);
  console.log(`  natural recall (contradicted -> contradiction): ${con.contradiction}/${rowTotal(con)} — UNDERPOWERED, report as a count`);
  const ovr = confusion.overstated;
  console.log(`  blind spot (overstated -> entailment): ${ovr.entailment}/${rowTotal(ovr)} = ${pct(ovr.entailment, rowTotal(ovr))} — no threshold, descriptive`);
  const unr = confusion.unrelated;
  console.log(`  (unrelated -> entailment): ${unr.entailment}/${rowTotal(unr)} = ${pct(unr.entailment, rowTotal(unr))}`);

  // --- arm 2: synthetic contradictions ----------------------------------------------
  // Drawn from SUPPORTED rows only: reversing a claim the judge already found supported by
  // this paragraph yields a sentence the paragraph does refute. Reversing an `unrelated`
  // claim would produce another unrelated claim, and the "known" label would be a fiction.
  const supRows = seededShuffle(labelled.filter((l) => l.row.verdict === "supported").map((l) => l.row), SEED).slice(0, N_SYNTHETIC);
  process.stdout.write(`arm 2 (synthetic, from ${supRows.length} supported rows): `);
  let caught = 0, missedNeutral = 0, missedEntail = 0, constructionFailed = 0, synUnparsed = 0;
  const synMisses: { row: ClaimRow; reversed: string; label: NliLabel }[] = [];
  for (const [i, r] of supRows.entries()) {
    let reversed: string | null = null;
    try { reversed = await call1(reverser, buildReversalPrompt(r.text), (s) => parseReversal(s, r.text)); }
    catch (e) { callFailures++; console.warn("  [reverser failed]", e instanceof Error ? e.message : String(e)); }
    if (!reversed) { constructionFailed++; continue; }
    const label = await check(r.paragraphText!, reversed);
    if (label === null) { synUnparsed++; continue; }
    if (label === "contradiction") caught++;
    else {
      if (label === "neutral") missedNeutral++; else missedEntail++;
      synMisses.push({ row: r, reversed, label });
    }
    if ((i + 1) % 10 === 0) process.stdout.write(`${i + 1} `);
  }
  const synScored = caught + missedNeutral + missedEntail;
  const recall = synScored === 0 ? 0 : caught / synScored;
  console.log("done\n");
  assertNoCallFailures(callFailures, "arm 2 (synthetic)");
  console.log("--- arm 2: manufactured negations (UPPER BOUND on sensitivity) ---");
  console.log(`  drawn ${supRows.length} · construction failed ${constructionFailed} · unparsed ${synUnparsed} · scored ${synScored}`);
  console.log(`  caught (contradiction): ${caught}/${synScored} = ${pct(caught, synScored)}`);
  console.log(`  missed as neutral: ${missedNeutral} · missed as entailment: ${missedEntail}`);

  // --- arm 3: negative control ------------------------------------------------------
  // Same claim, a paragraph from the SAME case that the claim does not cite. Same-case
  // rather than random-case on purpose: a cross-case pairing would be trivially neutral on
  // topic alone, and would validate nothing. This asks whether the checker can tell "this
  // decision discusses the area" from "this paragraph establishes the proposition".
  const byCase = new Map<string, Set<string>>();
  for (const r of usable) {
    if (!byCase.has(r.caseId)) byCase.set(r.caseId, new Set());
    byCase.get(r.caseId)!.add(r.sourceParagraph);
  }
  const paraText = new Map<string, string>();
  for (const r of usable) paraText.set(`${r.caseId}|${r.sourceParagraph}`, r.paragraphText!);
  const controlPool = seededShuffle(labelled.map((l) => l.row), SEED + 100)
    .map((r) => {
      const others = [...(byCase.get(r.caseId) ?? [])].filter((p) => p !== r.sourceParagraph);
      if (others.length === 0) return null;
      const other = seededShuffle(others, SEED + 200)[0];
      return { row: r, otherParagraph: other, otherText: paraText.get(`${r.caseId}|${other}`)! };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .slice(0, N_CONTROL);
  process.stdout.write(`arm 3 (negative control, ${controlPool.length} pairs): `);
  const control: Record<NliLabel, number> = { entailment: 0, neutral: 0, contradiction: 0 };
  let ctlUnparsed = 0;
  for (const [i, c] of controlPool.entries()) {
    const label = await check(c.otherText, c.row.text);
    if (label === null) { ctlUnparsed++; continue; }
    control[label]++;
    if ((i + 1) % 10 === 0) process.stdout.write(`${i + 1} `);
  }
  const ctlScored = NLI_LABELS.reduce((a, l) => a + control[l], 0);
  console.log("done\n");
  assertNoCallFailures(callFailures, "arm 3 (negative control)");
  console.log("--- arm 3: negative control (claim vs a paragraph it does not cite) ---");
  console.log(`  scored ${ctlScored} · unparsed ${ctlUnparsed}`);
  console.log(`  ${JSON.stringify(control)}`);
  console.log(`  entailment on non-cited paragraphs: ${pct(control.entailment, ctlScored)} — high means the checker matches TOPIC, not inference`);

  // --- decision ----------------------------------------------------------------------
  console.log(`\n  cache entries evicted and re-fetched (unparseable, e.g. written under a smaller budget): ${repairs}`);

  console.log("\n--- pre-registered decision ---");
  console.log(`  false alarm ${pct(sup.contradiction, rowTotal(sup))} (max ${(FALSE_ALARM_MAX * 100).toFixed(0)}%) · synthetic recall ${pct(caught, synScored)} (min ${(SYNTHETIC_RECALL_MIN * 100).toFixed(0)}%)`);
  console.log(`  VERDICT: ${decide(falseAlarm, recall).toUpperCase()}`);

  // --- samples -----------------------------------------------------------------------
  // The disagreements are what a reader needs to judge the numbers. Printed at 3 per cell
  // and full-length: the caseqa-eval sample printer truncates paragraphs to 120 chars, and
  // reading a truncated premise is how the n=3 version of this probe nearly checked
  // different evidence than the judge did.
  console.log("\n--- samples: judge SUPPORTED but NLI contradiction (false alarms) ---");
  for (const { row, label } of labelled.filter((l) => l.row.verdict === "supported" && l.label === "contradiction").slice(0, 3)) {
    console.log(`  ${row.caseId} ${row.sourceParagraph} [${label}]\n    claim: ${row.text}\n    para:  ${row.paragraphText}\n`);
  }
  console.log("--- samples: judge OVERSTATED but NLI entailment (the blind spot) ---");
  for (const { row } of labelled.filter((l) => l.row.verdict === "overstated" && l.label === "entailment").slice(0, 3)) {
    console.log(`  ${row.caseId} ${row.sourceParagraph}\n    claim: ${row.text}\n    para:  ${row.paragraphText}\n`);
  }
  console.log("--- samples: manufactured negations the checker MISSED ---");
  for (const m of synMisses.slice(0, 3)) {
    console.log(`  ${m.row.caseId} ${m.row.sourceParagraph} [${m.label}]\n    original: ${m.row.text}\n    reversed: ${m.reversed}\n    para:     ${m.row.paragraphText}\n`);
  }

  // Persisted for the same reason the eval rows are: a run that has spent ~350 Bedrock
  // calls should not exist only as terminal scrollback.
  const outFile = rowsPath.replace(/\.jsonl$/, "") + ".nli.jsonl";
  await fs.writeFile(outFile, [
    JSON.stringify({ kind: "probe", sourceRunId: header?.runId, checker: CHECKER, reverser: REVERSER, seed: SEED,
      confusion, control, synthetic: { drawn: supRows.length, constructionFailed, unparsed: synUnparsed, scored: synScored, caught },
      decision: decide(falseAlarm, recall) }),
    ...labelled.map((l) => JSON.stringify({ kind: "nli", caseId: l.row.caseId, qid: l.row.qid,
      sourceParagraph: l.row.sourceParagraph, verdict: l.row.verdict, label: l.label, text: l.row.text })),
    ...synMisses.map((m) => JSON.stringify({ kind: "synthetic-miss", caseId: m.row.caseId,
      sourceParagraph: m.row.sourceParagraph, original: m.row.text, reversed: m.reversed, label: m.label })),
  ].join("\n") + "\n", "utf8");
  console.log(`\nprobe rows -> ${outFile}`);

  // Reconciliation, computed WITHOUT reusing the counters under test: sum the matrix from
  // scratch and compare to the independently-tracked labelled list. This project has twice
  // shipped assertions that could not fire because they re-derived their check from the
  // branch that assigned the bucket.
  const matrixTotal = JUDGE_VERDICTS.reduce((a, v) => a + rowTotal(confusion[v]), 0);
  if (matrixTotal !== labelled.length) throw new Error(`matrix holds ${matrixTotal} but ${labelled.length} rows were labelled`);
  if (labelled.length + unparsed !== usable.length) throw new Error(`labelled ${labelled.length} + unparsed ${unparsed} != usable ${usable.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
