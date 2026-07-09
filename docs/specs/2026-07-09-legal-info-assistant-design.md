# Indigenous Economic-Justice Legal-Information Assistant — Design

**Date:** 2026-07-09 · **Status:** approved (design), pre-implementation · **Domain:** `src/app/cases/briefings/*`, `src/lib/cases/briefs/*`

## Motivation

The client asked for an "Indigenous legal-consultation AI" grounded in the corpus. The
whole project's governance spine is **legal INFORMATION, not legal ADVICE** — giving
situation-specific advice crosses into regulated legal practice (UPL/liability in Canada)
and invites exactly the hallucination/over-reach the project is built to avoid.

Rather than build a new advice-giving assistant, we **reframe the existing briefing
feature** (`/cases/briefings`) into an **Indigenous economic-justice legal-information
assistant**: the user asks a question in plain language and gets a grounded, citation-anchored
answer about *what Canadian courts have decided* — never advice about their situation.

This is deliberately a **reframe, not a rewrite**: the briefing engine already is a grounded
RAG Q&A engine with a fabrication-proof gate. We reuse it whole and change only the
**framing (UX/copy), the prompt, and add one mechanical advice-deflection guard**. Scope
was chosen as **option A (lean reframe)** over a conversational multi-turn assistant.

## What is reused UNCHANGED (the governed engine)

Nothing in the retrieval → generation → verification → storage spine changes:

- **Retrieval** — `dynamoCaseRepo.hybridSearch(question, { tier: "core" })`, top-6
  (`run.ts`). Same ranked search as the site.
- **Fabrication-proof gate** — `verifyBriefing` (`generator.ts`): only retrieved case ids
  survive; principles keep only valid ids; **< 2 distinct precedents → `null` → the
  assistant refuses rather than bluff**.
- **Output contract** — `BriefingBody { background, precedents[], principles[],
  considerations }` (`types.ts`) is **unchanged**, so `parseBriefing`, `verifyBriefing`,
  the repo, and the result-page rendering are all untouched.
- **Storage / flow** — `repo.ts` (Dynamo items, question-hash cache, daily quota),
  `actions.ts` (session gate → validate → cache → quota → create → worker), `run.ts`
  (shared runner), `brief-generate.ts` (async Lambda worker), SST wiring — all unchanged.
- **Access** — login gate + per-requester daily quota — unchanged.

The route stays `/cases/briefings` and the internal type/function names stay `Brief*`
(URL stability — recent-list links, cached `QHASH#` pointers, and the demo doc all
reference `/cases/briefings/{id}`; renaming would break them for zero user benefit).

## What changes

Five focused changes — copy, one prompt, one small pure module, and disclaimers.

### A. Entry UX reframe — `src/app/cases/briefings/page.tsx` + nav label

Reframe the entry from "Briefing notes / Precedent → policy" into an inviting
legal-information assistant:

- Eyebrow: `Precedent → policy` → **`Indigenous economic justice · ask the case law`**.
- Title: `Briefing notes` → **`Legal information assistant`**.
- Intro copy: reframe to invite a question and state the red line up front, e.g.:
  > "Ask what Canadian courts have decided on Indigenous economic-justice questions —
  > duty to consult, treaty and land rights, resource revenue, equitable compensation.
  > You get a plain-language answer grounded in the curated case record, with every point
  > linked to its source. **This is legal information, not legal advice** — for advice about
  > a specific situation, consult qualified counsel or an Indigenous legal clinic."
- Textarea placeholder reframed to an Indigenous economic-justice example, e.g.
  *"e.g. What have courts required before approving resource development on treaty land?"*
- Nav label in `src/app/cases/layout.tsx:13`: `Briefings` → **`Legal info`** (href
  `/cases/briefings` unchanged).

The login gate, the `err=quota` / `err=length` banners, and the recent list stay as-is.

### B. Prompt reframe — `buildBriefPrompt` in `src/lib/cases/briefs/generator.ts`

Reframe the prompt's role and rules (the **JSON output contract stays byte-identical**):

- **Role:** "You are an Indigenous economic-justice **legal-information assistant**. You
  answer questions about what Canadian courts have decided, based ONLY on the decisions
  provided below. You provide legal **information**, never legal advice."
- **Indigenous-law framing:** stay within the Indigenous economic-justice record; name the
  nation / community and context where the decision does; describe only what the courts
  held — **do not speak on behalf of Indigenous peoples and do not assert rights beyond
  what a decision establishes**.
- **Advice-deflection instruction:** if the question asks what someone should do in their
  own situation (e.g. "what should we do", "can I sue", "do we have a claim"), the
  `considerations` field must state that this is **general legal information, not advice on
  their situation**, and that they should consult qualified counsel or an Indigenous legal
  clinic — while still describing what the precedents establish.
- **Preserved verbatim** so the existing gate + tests hold: the strict JSON block, the
  `precedents`/`principles`/`considerations` keys, the "Cite ONLY case ids that appear as
  [case <id>]" rule, "2 to 6 precedents", and the phrase **"do NOT give advice,
  recommendations, or predictions"** (the offline test asserts `/do NOT give advice/i` and
  `prompt.includes('"precedents"')`).

Because only the prompt *text* changes and the JSON shape is identical, `parseBriefing` /
`verifyBriefing` / `generateBriefing` are untouched.

### C. Advice-deflection mechanical guard — new `src/lib/cases/briefs/advice.ts`

A pure, deterministic classifier that surfaces the not-advice framing mechanically (in the
project's "mechanical gate over trusting the model" spirit), independent of the prompt:

```ts
// Heuristic: does the question ask for situation-specific advice (first/second person),
// as opposed to informational ("what have courts decided"). Conservative by design —
// a miss only means we skip the extra banner (the standing disclaimer always shows, and
// the prompt-level deflection still applies). Never a gate; purely a display surface.
export function isAdviceSeeking(question: string): boolean;
```

Matched (case-insensitive, over the lowercased question) — see the contract table below.
Rendered as a visible banner on the result page when true (change D). No storage change:
it is a pure function of `question`, recomputed at render — so cached briefs and failed
briefs get the banner correctly too.

### D. Result-page disclaimer + banner — `src/app/cases/briefings/[id]/page.tsx`

- Strengthen the standing disclaimer (shown on the `done` view) from "AI-generated
  briefing · not legal advice" to explicitly point to counsel: e.g. *"AI-generated legal
  **information**, not legal advice. For advice about a specific situation, consult
  qualified counsel or an Indigenous legal clinic. Every precedent links to its source —
  verify each point there."*
- Add an **advice-deflection banner** rendered when `isAdviceSeeking(b.question)` is true,
  on **all** rendered states (done, failed, and stale/pending), above the content:
  > "This question reads as asking about a specific situation. The assistant provides
  > **general legal information, not advice** — for advice, consult qualified counsel or an
  > Indigenous legal clinic."
- Everything else on the result page (Background / Precedents / Principles / Considerations
  sections, per-precedent case links, provenance footer) is unchanged.

### E. Methodology note — `src/app/cases/methodology/page.tsx`

Update the existing briefing section to describe the legal-information framing and the
advice-deflection guard (prompt-level + the mechanical `isAdviceSeeking` banner), reaffirming
the "information not advice" red line. Small copy edit; no structural change.

## Explicitly NOT doing (YAGNI + red lines)

- **No advice.** No recommendations, predictions, or situation-specific guidance — enforced
  by the prompt (change B) and, ultimately, by `verifyBriefing`'s grounding gate.
- **No conversational multi-turn** assistant (option B) — deferred. Each question is
  independent, as today.
- **No new retrieval / storage / model architecture** — the engine is reused whole.
- **No route or type rename** — `/cases/briefings` and `Brief*` names stay.
- **No hard block on advice-seeking questions** — the grounded information is still useful;
  the guard surfaces the disclaimer, it does not refuse. (Ungrounded questions still refuse
  via the existing < 2-precedent gate.)

## Architecture — files touched

| File | Change |
|---|---|
| `src/lib/cases/briefs/advice.ts` | **New.** Pure `isAdviceSeeking(question)` classifier. |
| `src/lib/cases/briefs/generator.ts` | Reframe `buildBriefPrompt` text (JSON contract + asserted substrings preserved). |
| `src/app/cases/briefings/page.tsx` | Entry copy + placeholder reframe. |
| `src/app/cases/briefings/[id]/page.tsx` | Strengthened disclaimer + `isAdviceSeeking` banner. |
| `src/app/cases/layout.tsx` | Nav label `Briefings` → `Legal info`. |
| `src/app/cases/methodology/page.tsx` | Briefing-section copy reframe. |
| `scripts/test-cases-briefs.ts` | Extend: advice classifier cases + prompt-framing assertions. |

Unchanged: `types.ts`, `repo.ts`, `run.ts`, `actions.ts`, `brief-generate.ts`, SST config,
`verifyBriefing`/`parseBriefing`/`generateBriefing` logic.

## `isAdviceSeeking` contract

Conservative first/second-person situation-advice detection. Returns `true` for
advice-seeking phrasing, `false` for informational questions.

| Question | Expected |
|---|---|
| "What should we do before starting a mine on our territory?" | `true` |
| "Can I sue the Crown for failure to consult?" | `true` |
| "Do we have a claim if the province approved the project without us?" | `true` |
| "What are my options if my Nation wasn't consulted?" | `true` |
| "Will we win a duty-to-consult case?" | `true` |
| "How do I file an Aboriginal title claim for our land?" | `true` |
| "What is the duty to consult?" | `false` |
| "What have courts required before approving mining on treaty land?" | `false` |
| "How has the Supreme Court interpreted equitable compensation?" | `false` |
| "Which cases discuss resource revenue sharing?" | `false` |

Implementation: lowercase the question, test against a small set of anchored patterns for
first/second-person advice-seeking (e.g. `should i|we`, `can i|we (sue|claim|win)`,
`do (i|we) have (a|any) (case|claim|right)`, `what (are|were) (my|our) (option|right|chance)`,
`how do (i|we)`, `will (i|we) win`, `is my|our (case|claim|situation)`). Deliberately favours
false negatives over false positives.

## Testing (offline, TDD)

Extend `scripts/test-cases-briefs.ts` (single offline suite, fake models — no network):

1. **Advice classifier** — assert `isAdviceSeeking` returns `true` for each advice-seeking
   example and `false` for each informational example in the contract table above.
2. **Prompt framing** — assert the reframed `buildBriefPrompt` contains the new framing
   markers (e.g. `/legal information/i`, `/Indigenous/`, an advice-deflection instruction),
   **and** still contains the preserved substrings the pipeline depends on
   (`/do NOT give advice/i`, `'"precedents"'`, the question and context sentinels).
3. **Regression** — all existing generator/parser/verifier/repo assertions stay green
   (the JSON contract is unchanged).

Gate: `npm run typecheck` clean, `npm run build` compiles, `npx tsx scripts/test-cases-briefs.ts`
passes. `verify` (browser) not required — reframe is copy/prompt/pure-logic; a browser
spot-check of the reframed entry + result banner is a nice-to-have, not a gate.

## Governance / safety alignment

- **Information, not advice** — stated in the prompt, the entry copy, the strengthened
  result disclaimer, the mechanical advice-deflection banner, and the standing site-wide
  banner. Belt and suspenders on the project's central red line.
- **Fabrication-proof** — unchanged: only retrieved cases can be cited; < 2 precedents →
  refuse.
- **Indigenous data sovereignty / voice** — prompt framing keeps outputs to what courts
  held and avoids speaking for Indigenous peoples; sources remain the official-open corpus.
- **No fabricated economic figures** — inherited; the briefing engine cites case profiles,
  not invented numbers.

## Success criteria

- **Offline:** advice-classifier + prompt-framing tests green; all existing briefs tests
  stay green; typecheck + build clean.
- **UX:** the entry reads as a legal-information assistant with the not-advice red line and
  a consult-counsel pointer; advice-seeking questions get the mechanical banner; the answer
  format and grounding are unchanged.
- **No regressions:** retrieval, verification, storage, quota, and login all behave exactly
  as before; no data migration.

## Deferred

- **Conversational multi-turn** assistant (option B) — follow-up questions with context.
- **Indigenous legal-clinic directory** — the disclaimer points to "an Indigenous legal
  clinic" generically; a curated, verified referral list is a separate content task.
