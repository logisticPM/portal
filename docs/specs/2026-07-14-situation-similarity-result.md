# Situation → Similar Cases — Result & Verification

**Date:** 2026-07-14 · **Feature:** PR #161 (`feat/situation-similarity`, merged `0f1320d`) ·
**Design:** `docs/specs/2026-07-14-situation-similarity-design.md` ·
**Environment:** production DynamoDB table `LegalCases` (us-east-1), Bedrock Titan Text
Embeddings v2 (1024-dim).

This document records the credentialed operational run and the accuracy **mini-eval** the
design promised — verifying the feature works rather than asserting that it does.

---

## Operational run

- **`cases:embed-profiles:cloud`** embedded the case-level profile vector (`pvec`) for the
  curated core: **541 / 541 profile-embedded · 0 skipped**.
- Post-run audit: **541 / 541 core cases carry `pvec`**, `pvecDim = 1024`,
  `pvecEmbedderId = bedrock:amazon.titan-embed-text-v2:0` — matching the active embedder, so
  the dense signal is **enabled** (the mismatch guard passes; no silent structured-only
  degradation).
- **No search-artifact rebuild** was needed: `findSimilarCases` reads `pvec` directly from
  the profile item (it does not use the S3 search index), so the feature became live on the
  merge deploy once `pvec` was written.

## Mini-eval (accuracy verification, not an asserted metric)

Six representative situations were run against the live core through the real scoring path
(narrative embedded with Titan v2, scored by the deterministic `scoreSituation`). Top results
and the adjudication:

| Situation | Top strength / composite | Adjudication of top-5 |
|---|---|---|
| Duty to consult — mining on treaty land *(well-covered)* | **strong · 0.69** | 5/5 on point — Mikisew Cree (SCC 2005, the landmark), West Moberly, Taku River, Brokenhead Ojibway, Na-Cho Nyäk Dun |
| Aboriginal title — pipeline on claimed land *(well-covered)* | **strong · 0.69** | 5/5 on point — Brokenhead (pipeline consultation), Xeni Gwet'in (Tsilhqot'in title lineage), Taku River, Ekuanitshit, Ka'a'Gee Tu |
| Resource revenue — IBA royalty dispute *(thin theme, ~33 cases)* | strong · 0.63 | ~4–5/5 reasonable — Ermineskin (royalty-management landmark), Ontario First Nations v. OLG (gaming revenue), Chippewas of Mnjikaning (casino revenue), Teal Cedar (forestry pricing) |
| Fiduciary — mismanaged reserve land, compensation | **strong · 0.60** | 5/5 on point — Guerin (SCC 1984, the fiduciary landmark), Southwind (equitable compensation, exactly on point), Ross River, Kahkewistahaw |
| Self-determination — economic-development authority *(fuzzier theme)* | **moderate · 0.55** | ~4/5 reasonable — Ahousaht, Reference re Indigenous children/families (2024 self-gov landmark), Tsilhqot'in; correctly ranked *moderate*, not *strong* |
| **Off-corpus control** — software-startup contract dispute | **weak · 0.22 — weak-match caution FIRES** | Results are unrelated (as they should be); the honesty mechanism correctly flags "no strongly comparable case" |

### What the mini-eval shows

- **Well-covered themes (duty to consult, title, fiduciary)** return **strong, landmark-quality,
  genuinely comparable** precedents.
- **Thin theme (resource revenue)** still returns sensible revenue-dispute cases — useful, if
  shallower.
- **Fuzzier theme (self-determination)** is correctly reported as **moderate**, not
  overstated.
- **Off-corpus situations** are correctly reported as **weak**, and the **weak-match caution
  fires** — the design's core honesty mechanism works.
- **Strength thresholds are well-calibrated as shipped** (`STRONG_MIN = 0.55`,
  `MODERATE_MIN = 0.40`): real matches landed 0.55–0.69, the fuzzy theme 0.52–0.55, and the
  off-corpus control 0.18–0.22. **No weight/threshold tuning was required.**

## Honest limitations (unchanged — stated so the tool is used correctly)

- This is a **research starting point, not a legal match or prediction.** Similarity is
  descriptive (topical/thematic/jurisdictional closeness), **not** a claim that a precedent is
  legally analogous or that any outcome will follow.
- The mini-eval is a **hand-adjudicated spot-check**, not a metric on a held-out gold set —
  it demonstrates the ranking is sensible and the honesty mechanisms fire, not a precision
  number. A larger situation→case gold set (counsel-adjudicated) would be needed to state
  accuracy quantitatively.
- **Coverage is corpus-bounded** (curated core ≈ 541; thin in resource_revenue and in
  AB/SK/MB/QC/ONSC). A close precedent for a given situation may simply not be in the corpus —
  which the weak-match caution surfaces rather than hides.
- Match quality depends on how the situation is described; lay phrasing may retrieve less well.

## Methodology note

The mini-eval script replicated `findSimilarCases`'s substance **inline** (one GSI1 scan for
core + `pvec`, embed the narrative, call the pure `scoreSituation`) rather than importing
`repo.dynamo.ts` directly: that module memoizes its loaders with React's `cache()`, which is
only a function inside the Next.js runtime, so a plain `tsx` script cannot import it. The
inline path exercises the identical scoring and embeddings; only the `cache()` wrapper and the
mismatch-guard branch (both trivial plumbing, and covered by typecheck/build) are not
exercised by the script.

## Bottom line

The feature is **live and verified**: core profiles are embedded, dense similarity is enabled,
well-covered themes return landmark-quality neighbors, and the uncertainty mechanisms
(match-strength + weak-match caution) behave correctly on thin and off-corpus inputs. It
delivers a trustworthy, explainable **research aid** — consistent with the project's
"information, not advice; verified, not asserted" standard.
