# RAP Extraction Engine Comparison — Results

Generated 2026-08-08T00:47:56.882Z · n=8 (BankOfCanada gold + 7). Dual judges: us.amazon.nova-pro-v1:0 + deepseek.v3.2. Inter-judge κ = **0.000**.

## Scorecard

| Engine | Gold P / R / F1 (BoC) | Grounding: quote-present | Grounding: page-correct | Commitments found | Corroborated (≥2 engines) | Est. cost | Total time |
|---|---|---|---|---|---|---|---|
| bda | 100% / 91% / 0.95 | 66/158 | N/A (inferred) | 158 | 79 | $7.92 | 878s |
| textract | 85% / 100% / 0.92 | 156/311 | 153/311 | 311 | 168 | $3.44 | 2009s |
| textlayer | 88% / 100% / 0.94 | 152/280 | 151/280 | 280 | 190 | $2.13 | 1489s |

> Recall on the 7 non-gold docs is **relative to the union of all engines' finds** — a defect all three miss is invisible here. BDA page numbers are inferred and are never used as a page reference. All figures are absolute counts, not agreement ratios.

## Judge adjudication

678 findings judged; 10 disagreements → worklist (capped 25). Open `results/worklist.html` to resolve.

**Inter-judge κ = 0.000 is a real finding, not a scoring artifact.** Of the cached
judge responses, 1131 were `{"real": true}` and 9 were `{"real": false}` — both
Nova Pro and DeepSeek (independent non-Claude families) assent to ~99% of
extracted commitments. Their 98.5% observed agreement is therefore entirely
chance-explained, so κ collapses to 0. This reproduces the decorrelation paper's
ecological-boundary result (κ=0.03 on unlabeled industrial code, "Nova labels 99%
genuine"): **LLM correctness judges give no decorrelated verification signal on
real, unlabeled RAP extraction data.** Practical consequence — auto-validation by
LLM agreement does not work here; the human-in-the-loop review the portal already
has is the right instrument, and these judges are useful only to surface the
handful of disagreements (10) for a person to look at.

## Findings

- **Gold accuracy (Bank of Canada, the one oracle-labeled doc).** All three are
  strong and close on F1: BDA 0.95, text-layer 0.94, Textract 0.92. BDA is the most
  conservative — 100% precision but 91% recall (20 clean commitments, missed 2 of
  22). Textract and text-layer both hit 100% recall (found all 22) at slightly lower
  precision (a few extra commitments). *n=1, so treat this as the anchor, not the
  whole story.*
- **Grounding fidelity (the differentiator).** text-layer leads — 54% of values
  carry a verbatim-present quote AND a correct page; Textract close behind
  (50% quote, 49% page); BDA worst at 42% quote-present and **no trustworthy page
  at all** (it grounds by confidence and infers pages). This confirms the design
  thesis: the verbatim-quote engines ground far better than BDA's confidence-based
  grounding, which matters for a citation-anchored, provenance-first platform.
- **Coverage / relative recall (7 non-gold docs, vs the union of all finds).**
  Textract surfaces the most commitments (311), text-layer 280 (and the most
  *corroborated* by ≥2 engines, 190), BDA the fewest (158). BDA's lower count is
  partly conservatism and partly the Deloitte failure below.
- **Cost & speed.** text-layer is cheapest ($2.13) and mid-speed; Textract $3.44
  and slowest (Textract's async job latency); BDA priciest ($7.92, the $0.040/page
  custom blueprint) but fastest wall-clock.
- **Robustness (real, on this corpus).** Textract completed **8/8**. The
  **text-layer loader** crashed on RBC (`undefined … 'split'` — a glyph-geometry
  edge case). **BDA** failed on Deloitte, whose PDF has malformed object refs that
  `pdf-lib` (used for BDA's ≤20-page chunk-splitting) could not parse. Neither is a
  harness bug; both are genuine engine/loader robustness limits.
- **Scanned-PDF axis untested** — the corpus is entirely born-digital, so
  text-layer's known blindness to image-only scans (no OCR) does not show here; it
  remains a qualitative caveat.

## Recommendation (for the client's own, unrestricted AWS account)

Weighted quality 50% / operational 30% / residency 20%:

**Primary: Bedrock + Textract-LAYOUT.** It has the best coverage, 100% gold recall,
real (read, not inferred) page numbers, solid quote grounding, and was the only
engine to process all 8 documents. Crucially, the one thing blocking it *here* — the
org SCP that denies Textract to Lambda roles — **does not exist on the client's own
account**, so on their account it runs as a fully automated Lambda pipeline, not an
SSO-only script. Its costs (a bit slower, ~$0.004/page Textract on top of Claude)
are modest.

**Residency-max / low-cost fallback: Bedrock + text-layer.** Best grounding fidelity,
cheapest, needs no AWS text service (so it's the closest to in-country data
handling), and its finds are the most corroborated. Use it for born-digital PDFs
where cost or residency dominates — but keep Textract available for scanned or
structurally-awkward documents (text-layer has no OCR and crashed on RBC).

**BDA: only where speed outweighs provenance.** Fastest and highest gold precision,
but it grounds by confidence with inferred pages (weakest for a citation-anchored
product), is the most expensive per page, and is the most brittle on odd PDFs
(Deloitte). Not the default for this platform's provenance-first goals.

**Cross-cutting caveat:** because LLM-judge auto-validation does not transfer to this
data (κ=0), whichever engine is chosen, the **human-in-the-loop review stays load-
bearing** — it is not replaceable by an LLM agreement check.

### Is Bedrock + Textract-LAYOUT valid in Canada?

This qualifies the "primary" recommendation, because the platform's residency story
lives in ca-central-1:

- **Textract (incl. LAYOUT) is available as a service in ca-central-1**, and a human
  SSO session already invokes it there — so the *document-reading* step can run
  in-country.
- **On the current `ca` account**, Textract-for-Lambda is denied by the parent-org
  SCP (principal-conditional: human principals yes, Lambda execution roles no). So
  Bedrock+Textract **cannot be the automated `ca` pipeline today** — which is exactly
  why the `ca` stage ships **text-layer**. On the client's own account (no such SCP),
  Bedrock+Textract runs as an automated Lambda in ca-central-1.
- **The Claude extraction step is Bedrock inference, and Canada is not a Bedrock
  inference geography** — so that step routes to the `us.`/global inference profile
  regardless of engine (text-layer has the identical limitation). "In CA" therefore
  means **data-at-rest + document-reading in Canada; the LLM inference still leaves
  Canada.** Hosting ≠ inference.

**Net:** on the client's own account, Bedrock+Textract is CA-valid at the storage +
OCR layer (and is the primary recommendation). On an SCP-restricted account — or when
maximal in-country document handling is the priority — **text-layer** is the only
automated in-country reader, and its grounding fidelity here was actually the best of
the three. Neither engine achieves in-country *inference*; that is a Bedrock-geography
limitation, not an engine choice.

*Method notes: gold P/R/F1 is n=1 (Bank of Canada); non-gold recall is relative to
the union of all engines and cannot see a defect all three miss; BDA pages are never
used as a reference; all counts are absolute, not ratios. The run executed in
us-east-1 for all engines (region does not affect extraction quality — the loader
and model do — and avoids cross-region S3 reads).*
