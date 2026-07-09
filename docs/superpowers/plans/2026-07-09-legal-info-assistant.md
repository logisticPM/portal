# Indigenous Economic-Justice Legal-Information Assistant — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reframe the existing briefing feature (`/cases/briefings`) into an Indigenous economic-justice legal-information assistant — reusing the retrieval + fabrication-proof generation engine unchanged, changing only the prompt, the UX/copy, and adding one pure advice-deflection guard.

**Architecture:** The briefing engine (hybridSearch `tier:core` → `generateBriefing` → `verifyBriefing` `<2 precedents → refuse` → Dynamo storage + login/quota) is reused whole. `BriefingBody`'s JSON contract is byte-identical, so `parseBriefing`/`verifyBriefing`/repo/result-rendering are untouched. Four changes: (1) a new pure `isAdviceSeeking` classifier, (2) a reframed `buildBriefPrompt` (Indigenous-law framing + advice-deflection instruction, contract preserved), (3) reframed UX copy + a result-page advice banner + nav label, (4) a methodology note + the offline gate.

**Tech Stack:** TypeScript, Next.js 14 App Router (RSC), Node test scripts run via `tsx`, Tailwind utility classes.

**Spec:** `docs/specs/2026-07-09-legal-info-assistant-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/cases/briefs/advice.ts` | **New.** Pure `isAdviceSeeking(question)` heuristic — the advice-deflection guard. |
| `src/lib/cases/briefs/generator.ts` | Reframe `buildBriefPrompt` text only (JSON contract + asserted substrings preserved). |
| `src/app/cases/briefings/page.tsx` | Entry copy + placeholder reframe. |
| `src/app/cases/briefings/[id]/page.tsx` | Strengthened disclaimer + conditional advice banner. |
| `src/app/cases/layout.tsx` | Nav label `Briefings` → `Legal info`. |
| `src/app/cases/methodology/page.tsx` | Briefing-section copy reframe. |
| `scripts/test-cases-briefs.ts` | Extend: advice-classifier cases + prompt-framing assertions. |

Unchanged: `types.ts`, `repo.ts`, `run.ts`, `actions.ts`, `brief-generate.ts`, SST config, and the `verifyBriefing`/`parseBriefing`/`generateBriefing` logic.

---

### Task 1: `isAdviceSeeking` pure classifier

**Files:**
- Create: `src/lib/cases/briefs/advice.ts`
- Test: `scripts/test-cases-briefs.ts` (extend the existing suite)

- [ ] **Step 1: Write the failing test**

Add this block to `scripts/test-cases-briefs.ts` immediately before the final
`console.log("✅ test-cases-briefs passed");` line:

```ts
  // --- advice-deflection classifier (spec 2026-07-09) ---
  const { isAdviceSeeking } = await import("../src/lib/cases/briefs/advice");
  const adviceSeeking = [
    "What should we do before starting a mine on our territory?",
    "Can I sue the Crown for failure to consult?",
    "Do we have a claim if the province approved the project without us?",
    "What are my options if my Nation wasn't consulted?",
    "Will we win a duty-to-consult case?",
    "How do I file an Aboriginal title claim for our land?",
  ];
  const informational = [
    "What is the duty to consult?",
    "What have courts required before approving mining on treaty land?",
    "How has the Supreme Court interpreted equitable compensation?",
    "Which cases discuss resource revenue sharing?",
  ];
  for (const q of adviceSeeking) assert.ok(isAdviceSeeking(q), `should flag advice: ${q}`);
  for (const q of informational) assert.ok(!isAdviceSeeking(q), `should NOT flag info: ${q}`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-cases-briefs.ts`
Expected: FAIL — `Cannot find module '../src/lib/cases/briefs/advice'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/cases/briefs/advice.ts`:

```ts
// Advice-deflection guard (spec 2026-07-09). PURE + deterministic: does a question
// ask for situation-specific legal advice (first/second person), as opposed to general
// legal information ("what have courts decided")? Used ONLY as a display surface — a
// visible "information, not advice" banner on the result page. Never a gate: a miss just
// skips the banner (the standing disclaimer always shows, and the prompt-level deflection
// still applies). Deliberately conservative — favours false negatives over false positives.
const ADVICE_PATTERNS: RegExp[] = [
  /\bwhat should (i|we)\b/,
  /\bshould (i|we)\b/,
  /\bcan (i|we) (sue|claim|win|challenge|appeal|force|stop|block)\b/,
  /\bdo (i|we) have (a |an |any )?(case|claim|right|grounds|standing)\b/,
  /\bwhat (are|were) (my|our) (option|options|right|rights|chance|chances)\b/,
  /\bhow (do|can|would|should) (i|we)\b/,
  /\bwill (i|we) (win|lose|succeed)\b/,
  /\bis (my|our) (case|claim|situation|land|band|nation|community)\b/,
  /\b(am i|are we) (entitled|allowed|able|likely|liable|required|eligible)\b/,
];

export function isAdviceSeeking(question: string): boolean {
  const q = question.toLowerCase();
  return ADVICE_PATTERNS.some((re) => re.test(q));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-cases-briefs.ts`
Expected: PASS — `✅ test-cases-briefs passed` (all existing assertions + the new block).

- [ ] **Step 5: Commit**

```bash
git add src/lib/cases/briefs/advice.ts scripts/test-cases-briefs.ts
git commit -m "feat: add isAdviceSeeking advice-deflection guard"
```

---

### Task 2: Reframe `buildBriefPrompt`

**Files:**
- Modify: `src/lib/cases/briefs/generator.ts` (the `buildBriefPrompt` function, lines 22-39)
- Test: `scripts/test-cases-briefs.ts` (extend the existing prompt-assertion block)

- [ ] **Step 1: Write the failing test**

In `scripts/test-cases-briefs.ts`, find the existing prompt block (the assertions on
`const prompt = buildBriefPrompt(...)` — currently checking the question, `CTX-SENTINEL`,
`"precedents"`, and `/do NOT give advice/i`). Add these assertions immediately after the
existing `assert.ok(/do NOT give advice/i.test(prompt));` line:

```ts
  // reframed as an Indigenous economic-justice legal-INFORMATION assistant (spec 2026-07-09)
  assert.ok(/legal information/i.test(prompt), "prompt frames as legal information");
  assert.ok(/indigenous economic-justice/i.test(prompt), "prompt has Indigenous-law framing");
  assert.ok(/consult qualified counsel|indigenous legal clinic/i.test(prompt), "prompt has advice-deflection");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-cases-briefs.ts`
Expected: FAIL — the new `legal information` / Indigenous-framing / deflection assertions
fail against the current prompt.

- [ ] **Step 3: Write minimal implementation**

Replace the entire `buildBriefPrompt` function in `src/lib/cases/briefs/generator.ts` with:

```ts
export function buildBriefPrompt(question: string, context: string): string {
  return `You are an Indigenous economic-justice legal-information assistant. You answer questions about what Canadian courts have decided, based ONLY on the court decisions provided below. You provide legal INFORMATION, never legal advice.

QUESTION: ${question}

Produce STRICTLY this JSON (no markdown, no commentary):
{"background":"...","precedents":[{"caseId":"...","establishes":"...","relevance":"..."}],"principles":[{"text":"...","caseIds":["..."]}],"considerations":"..."}

Rules:
- Cite ONLY case ids that appear as [case <id>] below. Never invent a case.
- 2 to 6 precedents. "establishes": what the decision established (1-2 plain sentences). "relevance": why it matters for the question (1 sentence).
- 1 to 4 principles: cross-case principles, each listing its supporting case ids.
- "considerations": 2-4 sentences on what these precedents mean for the question. Describe what the law establishes — do NOT give advice, recommendations, or predictions.
- Stay within the Indigenous economic-justice record below. Name the nation or community and its context where a decision does. Describe only what the courts held — do not speak on behalf of Indigenous peoples, and do not assert rights beyond what a decision establishes.
- If the question asks what someone should do in their own situation (e.g. "what should we do", "can I sue", "do we have a claim"), "considerations" MUST state that this is general legal information, not advice on their situation, and that they should consult qualified counsel or an Indigenous legal clinic — while still describing what the precedents establish.
- Plain language. No legalese. No invented facts.

CASES:
${context}`;
}
```

Note: the JSON block, the `[case <id>]` rule, "2 to 6 precedents", `"precedents"`, and the
phrase "do NOT give advice, recommendations, or predictions" are preserved verbatim, so the
parser/verifier and the existing prompt assertions still hold.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-cases-briefs.ts`
Expected: PASS — `✅ test-cases-briefs passed` (existing prompt assertions + the 3 new ones,
and every parser/verifier/generator assertion unchanged and green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/cases/briefs/generator.ts scripts/test-cases-briefs.ts
git commit -m "feat: reframe brief prompt as Indigenous legal-information assistant"
```

---

### Task 3: UX reframe — entry page, result page, nav label

**Files:**
- Modify: `src/app/cases/briefings/page.tsx` (header block + textarea placeholder)
- Modify: `src/app/cases/briefings/[id]/page.tsx` (import guard, add banner to each branch, strengthen disclaimer)
- Modify: `src/app/cases/layout.tsx` (nav label, line 13)

No unit test (presentation/copy). Verified by `typecheck` + `build`; optional browser spot-check.

- [ ] **Step 1: Reframe the entry header + placeholder**

In `src/app/cases/briefings/page.tsx`, replace the header `<div>` block (currently lines
13-20, the eyebrow + `<h1>Briefing notes</h1>` + intro `<p>`) with:

```tsx
      <div>
        <div className="text-amber text-xs uppercase tracking-widest mb-1">Indigenous economic justice · ask the case law</div>
        <h1 className="font-serif text-3xl">Legal information assistant</h1>
        <p className="mt-1 text-sm text-ink3">
          Ask what Canadian courts have decided on Indigenous economic-justice questions —
          duty to consult, treaty and land rights, resource revenue, equitable compensation.
          You get a plain-language answer grounded in the curated case record, with every
          point linked to its source. Generates in ~30–60 seconds.{" "}
          <strong>This is legal information, not legal advice</strong> — for advice about a
          specific situation, consult qualified counsel or an Indigenous legal clinic.
        </p>
      </div>
```

Then replace the textarea `placeholder` attribute value with:

```tsx
            placeholder="e.g. What have courts required before approving resource development on treaty land?"
```

- [ ] **Step 2: Add the advice banner + strengthen the disclaimer on the result page**

In `src/app/cases/briefings/[id]/page.tsx`:

(a) Add the import near the top (after the existing imports):

```tsx
import { isAdviceSeeking } from "@/lib/cases/briefs/advice";
```

(b) Immediately after `if (!b) notFound();` (before the `stalePending` line), define the
banner once so it can be reused in every branch:

```tsx
  const adviceBanner = isAdviceSeeking(b.question) ? (
    <p className="rounded border border-amber/40 bg-amber/10 px-3 py-2 text-sm text-ink2">
      This question reads as asking about a specific situation. The assistant provides{" "}
      <strong>general legal information, not advice</strong> — for advice, consult qualified
      counsel or an Indigenous legal clinic.
    </p>
  ) : null;
```

(c) Render `{adviceBanner}` as the first child inside each of the three returned containers:
- the pending/generating `<div className="mx-auto max-w-3xl space-y-3">` (after the `<meta>`),
- the failed/stale `<div className="mx-auto max-w-3xl space-y-3">` (before the `<h1>`),
- the done `<div className="mx-auto max-w-3xl space-y-6">` (before the header `<div>`).

(d) Replace the done-view disclaimer `<p>` (currently lines 50-53, "AI-generated briefing ·
not legal advice…") with:

```tsx
        <p className="mt-2 rounded border border-line bg-amber/10 px-3 py-2 text-xs text-ink2">
          <strong>AI-generated legal information · not legal advice.</strong> For advice about
          a specific situation, consult qualified counsel or an Indigenous legal clinic. Every
          precedent below links to its case page — verify each point there (case summaries
          carry paragraph-level anchors).
        </p>
```

- [ ] **Step 3: Rename the nav label**

In `src/app/cases/layout.tsx` line 13, change the link text (keep the href):

```tsx
            <Link href="/cases/briefings" className="hover:text-amber">Legal info</Link>
```

- [ ] **Step 4: Verify typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: both succeed (no type errors; Next.js build compiles the three pages).

- [ ] **Step 5: Commit**

```bash
git add src/app/cases/briefings/page.tsx "src/app/cases/briefings/[id]/page.tsx" src/app/cases/layout.tsx
git commit -m "feat: reframe briefing UX as legal-information assistant + advice banner"
```

---

### Task 4: Methodology note + offline gate

**Files:**
- Modify: `src/app/cases/methodology/page.tsx` (the "Briefing notes" section, lines 55-56)

- [ ] **Step 1: Reframe the methodology section**

In `src/app/cases/methodology/page.tsx`, change the heading on line 55:

```tsx
          <h2 className="font-serif text-lg">Legal information assistant</h2>
```

and replace the paragraph on line 56 with:

```tsx
          <p>The legal-information assistant answers questions on demand: a question retrieves the most relevant curated cases (the same ranked search used across the site), and the model may cite <strong>only those retrieved cases</strong> — any invented case reference is mechanically discarded, and an answer with fewer than two verifiable precedents is refused rather than published. It describes what precedents establish, not what a reader should do. When a question reads as asking about a specific situation, a mechanical guard surfaces a reminder to consult qualified counsel or an Indigenous legal clinic. Answers are AI-generated, badged, rate-limited, and provide <strong>legal information, not legal advice</strong>.</p>
```

- [ ] **Step 2: Run the full offline gate**

Run: `npx tsx scripts/test-cases-briefs.ts && npm run typecheck && npm run build`
Expected: the briefs test prints `✅ test-cases-briefs passed`; typecheck clean; build compiles.

- [ ] **Step 3: Commit**

```bash
git add src/app/cases/methodology/page.tsx
git commit -m "docs: reframe methodology briefing note as legal-information assistant"
```

---

## Self-Review

**Spec coverage:**
- Change A (entry UX + nav) → Task 3 steps 1, 3. ✓
- Change B (prompt reframe) → Task 2. ✓
- Change C (`isAdviceSeeking`) → Task 1. ✓
- Change D (result disclaimer + banner) → Task 3 step 2. ✓
- Change E (methodology) → Task 4. ✓
- Testing (classifier + prompt-framing + regression) → Task 1 step 1, Task 2 step 1, and the gate in Task 4 step 2. ✓
- "Reuse unchanged" — no task touches `types.ts`/`repo.ts`/`run.ts`/`actions.ts`/verify logic. ✓

**Placeholder scan:** none — every code step shows the full code or the exact string edit.

**Type/name consistency:** `isAdviceSeeking(question: string): boolean` is defined in Task 1
and imported/called identically in Task 1's test and Task 3 step 2. The `BriefingBody` JSON
contract is unchanged, so no downstream signature drifts. The `@/lib/cases/briefs/advice`
import path matches the created file path.

**Note on regex escaping in the plan test block:** the `adviceSeeking`/`informational`
arrays use plain string questions (no regex), and the `isAdviceSeeking` patterns are anchored
on word boundaries so `informational` questions (third-person / abstract) do not match.
