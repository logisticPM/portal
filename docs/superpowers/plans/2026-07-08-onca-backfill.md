# ONCA Full-Text Backfill (v3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the proven SCC PDF backfill to the Ontario Court of Appeal (`coadecisions.ontariocourts.ca`, ~207 in-corpus no-text cases) by adding the host to the allowlist and generalizing `toDocumentUrl` — no runner or extractor changes.

**Architecture:** ONCA is Lexum/Decisia infra (same as SCC): its stored viewer URLs `…/coa/coa/en/item/<id>/index.do` map to direct PDFs `…/coa/coa/en/<id>/1/document.do`. The existing `toDocumentUrl` regex already produces this — only its SCC-only host guard blocks it. Drop that guard (the transform then applies to any `/item/<id>/index.do` path; non-matching URLs pass through unchanged) and add ONCA to `OPEN_HOSTS`. `pdfToText`/`cleanupPdfText`/`fetchOfficialText`/`ROBOTS_DENY` are unchanged. Bulk ops is captcha-gated (Phase-0 probe + slow pacing), post-merge.

**Tech Stack:** TypeScript, `tsx` test scripts (`node:assert/strict`, async IIFE — repo is **not** ESM). No new dependencies.

**Spec:** `docs/specs/2026-07-08-onca-backfill-design.md`

**Conventions:** Tests run with `npx tsx scripts/test-cases-official-source.ts` (no `npm test`). Offline gate = that test green + `npm run typecheck` clean + `npm run build` compiles. Do NOT run `npm run verify`. Commit after each task.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/lib/cases/ingest/official-source.ts` | Allowlist + `toDocumentUrl` generalization | **Modify** (2 spots) |
| `scripts/test-cases-official-source.ts` | Offline unit tests | **Modify** (extend + regressions) |
| `docs/research/2026-06-28-legal-corpus-construction-methodology.md` | Methodology log | **Modify** (append note) |

No runner / extractor / dependency changes.

---

## Task 1: ONCA allowlist + generalized `toDocumentUrl`

**Files:**
- Modify: `src/lib/cases/ingest/official-source.ts`
- Test: `scripts/test-cases-official-source.ts`

- [ ] **Step 1: Update tests (add ONCA + regressions)**

In `scripts/test-cases-official-source.ts`, replace the `isOpenSource` block (the comment `// --- isOpenSource (v2 = bccourts + SCC) ---` and its 4 assertions, lines ~7–11) with:

```ts
  // --- isOpenSource (v3 = bccourts + SCC + ONCA) ---
  assert.equal(isOpenSource("https://www.bccourts.ca/jdb-txt/sc/24/14/2024BCSC1490.htm"), true);
  assert.equal(isOpenSource("https://decisions.scc-csc.ca/scc-csc/scc-csc/en/item/14246/index.do"), true, "SCC open");
  assert.equal(isOpenSource("https://coadecisions.ontariocourts.ca/coa/coa/en/item/1234/index.do"), true, "ONCA open in v3");
  assert.equal(isOpenSource("https://www.canlii.org/en/bc/bcsc/doc/x.html"), false, "CanLII excluded");
  assert.equal(isOpenSource("not a url"), false);
```

Then, inside the `toDocumentUrl` test block, add an ONCA assertion right after the SCC transform assertion (after the `assert.equal(toDocumentUrl("https://decisions.scc-csc.ca/scc-csc/scc-csc/en/item/2189/index.do"), …)` call). Insert:

```ts
  assert.equal(
    toDocumentUrl("https://coadecisions.ontariocourts.ca/coa/coa/en/item/1234/index.do"),
    "https://coadecisions.ontariocourts.ca/coa/coa/en/1234/1/document.do",
    "ONCA viewer → document.do (generalized transform)");
```

(Keep the existing SCC transform, SCC `document.do`-passthrough, bccourts-passthrough, trailing-slash, and malformed-input assertions unchanged — they are the regression guard that generalizing the guard didn't break SCC/bccourts.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx scripts/test-cases-official-source.ts`
Expected: FAIL — ONCA `isOpenSource` is false (host not in allowlist) and/or the ONCA `toDocumentUrl` assertion fails (host guard returns the URL unchanged).

- [ ] **Step 3: Add ONCA to the allowlist**

In `src/lib/cases/ingest/official-source.ts`, change the `OPEN_HOSTS` const:

```ts
export const OPEN_HOSTS = ["www.bccourts.ca", "decisions.scc-csc.ca", "coadecisions.ontariocourts.ca"];
```

- [ ] **Step 4: Generalize `toDocumentUrl` (drop the SCC-only host guard)**

In the same file, in `toDocumentUrl`, delete the line:

```ts
    if (u.host !== "decisions.scc-csc.ca") return url;
```

so the function reads (leave the rest exactly as-is — the regex already has the optional trailing slash `\/?$` and the `${m[1]}/${m[2]}/1/document.do` rewrite):

```ts
export function toDocumentUrl(url: string): string {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/^(.*)\/item\/(\d+)\/index\.do\/?$/);
    if (!m) return url; // not a Lexum viewer URL (e.g. bccourts .htm) → unchanged
    u.pathname = `${m[1]}/${m[2]}/1/document.do`;
    return u.toString();
  } catch { return url; }
}
```

Also update the comment above the function if it names SCC specifically, so it reads that the transform covers the Lexum viewer-URL shape for any host (SCC, ONCA, future Lexum courts); non-matching URLs pass through.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx tsx scripts/test-cases-official-source.ts`
Expected: PASS (`✅ test-cases-official-source passed`) — ONCA allowed + transformed, SCC and bccourts regressions still hold.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: clean (exit 0).

- [ ] **Step 7: Commit**

```bash
git add src/lib/cases/ingest/official-source.ts scripts/test-cases-official-source.ts
git commit -m "feat(cases): ONCA allowlist + generalize toDocumentUrl to the Lexum viewer-URL shape"
```

---

## Task 2: Methodology note + offline gate

**Files:**
- Modify (append): `docs/research/2026-06-28-legal-corpus-construction-methodology.md`

- [ ] **Step 1: Append a methodology note**

Append to `docs/research/2026-06-28-legal-corpus-construction-methodology.md`:

```markdown

## 2026-07-08 — ONCA backfill (backfill v3)

Extended the official-source backfill to the Ontario Court of Appeal
(`coadecisions.ontariocourts.ca`, ~207 in-corpus no-text cases) — Lexum/Decisia infra
(same as SCC), so the existing PDF path (`pdfToText`/`cleanupPdfText`) applies unchanged.
Code change was minimal: add the ONCA host to `OPEN_HOSTS` and generalize `toDocumentUrl`
(drop the SCC-only host guard) so the `…/item/<id>/index.do → …/<id>/1/document.do`
transform covers any Lexum viewer URL; non-Lexum URLs (bccourts `.htm`) don't match the
pattern and pass through unchanged. ONCA judgments are English-only (cleaner than SCC's
bilingual PDFs). Bulk ops is gated on a Phase-0 captcha/fidelity probe (ONCA shares SCC's
Decisia infra, which captcha-gated under a burst) and runs with slow pacing
(`BACKFILL_SLEEP_MS≈2500`), stopping on any captcha 403. Governance unchanged: verbatim,
no LLM, additive-safe, `provenance.source="official_court"`, robots deny-list.
```

- [ ] **Step 2: Run the full offline gate**

Run: `npx tsx scripts/test-cases-official-source.ts` — expected PASS.
Run: `npm run typecheck` — expected clean.
Run: `npm run build` — expected: compiles (Next build completes, no type errors). Do NOT run `npm run verify`.

- [ ] **Step 3: Commit**

```bash
git add docs/research/2026-06-28-legal-corpus-construction-methodology.md
git commit -m "docs(cases): methodology note for ONCA backfill (v3)"
```

---

## Final review & handoff

After both tasks: dispatch a final whole-branch reviewer (focus: the `toDocumentUrl`
generalization does not mis-transform any real bccourts/SCC/ONCA URL, and no
runner/extractor behavior changed), then use superpowers:finishing-a-development-branch to
open the PR. The credentialed ops run (Phase-0 captcha/fidelity gate →
`BACKFILL_HOST=coadecisions.ontariocourts.ca BACKFILL_SLEEP_MS=2500` backfill → promote →
derived refresh → Result) happens **after merge**, gated on the probe.
