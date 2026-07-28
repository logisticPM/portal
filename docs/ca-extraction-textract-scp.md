# `ca` extraction — why it is not really extracting, and what actually blocks it

**Date:** 2026-07-27 · Tested live against the `ca` stage (`ca-central-1`, account `106189426706`).

Companion to `docs/rap-extraction-findings.md` (which engine and why). This one answers a
narrower question: *why does an upload on `ca` not produce a real extraction, and whose problem
is it to fix?*

---

## Answer (TL;DR)

**Two separate things look like one bug.**

1. **`ca` runs the mock engine.** `EXTRACTION_IMPL` defaults to `mock` off-prod
   (`sst.config.ts:170`), so an upload returns *canned output regardless of the PDF* — fast,
   plausible-looking, and completely unrelated to the document. It does not error, which is why
   this reads as "extraction is dead" rather than as a failure.
2. **Switching `ca` to the real engine does not work either** — it is blocked by an AWS
   **Organizations Service Control Policy** that we do not control.

The IAM half of #2 was a genuine bug on our side and is **fixed in this PR**. The SCP half is
**not fixable from this repo**, confirmed by live test on 2026-07-27.

---

## What we control, and fixed here

`pipeline.bedrock.ts:229,240` calls `StartDocumentAnalysis` / `GetDocumentAnalysis` (async
LAYOUT OCR). The shared `bedrockPerms` block granted only the *TextDetection* actions:

```
textract:AnalyzeDocument, textract:StartDocumentTextDetection,
textract:GetDocumentTextDetection, textract:DetectDocumentText
```

so the analysis actions were missing entirely. Live failure, 2026-07-26 19:47 UTC:

```
not authorized to perform: textract:StartDocumentAnalysis
because no identity-based policy allows the ... action
```

This PR adds `textract:StartDocumentAnalysis` and `textract:GetDocumentAnalysis`. That is a real
fix and worth landing regardless of the SCP — it is a latent gap that would bite the moment the
guardrail is lifted or the engine is used anywhere else.

---

## What we do not control

With the IAM gap closed, the same call fails differently:

```
not authorized to perform: textract:StartDocumentAnalysis
with an explicit deny in a service control policy:
arn:aws:organizations::123896930307:policy/o-k5jncqbs7x/service_control_policy/p-9n6l6a99
```

`123896930307` is the **organization management account**, owned by **derekja@uvic.ca**. Our
account `106189426706` is a member. SCP contents are not readable from a member account
(`organizations:DescribePolicy` → AccessDenied), and no identity policy can override an SCP deny.

### The SCP is principal-conditional, not account-wide

An earlier note recorded this deny as applying "account-wide." **That is wrong**, and the
distinction matters. Probed 2026-07-27 with the developer's Identity Center role
(`AWSReservedSSO_myisb_IsbUsersPS`):

```
aws textract start-document-analysis --region ca-central-1  → InvalidS3ObjectException
aws textract start-document-analysis --region us-east-1     → InvalidS3ObjectException
```

`InvalidS3ObjectException` means **authorization passed** — it failed only on a deliberately
fake bucket. So a human SSO session can call this API in both regions; the Lambda execution role
cannot. The SCP discriminates by principal.

This was worth establishing because "account-wide" implies the whole account is cut off from
Textract, which would be a much bigger governance story. It is not — only non-SSO principals are.

---

## The decisive test

Run end to end on 2026-07-27, after deploying the IAM fix above to `ca` with
`EXTRACTION_IMPL=bedrock`:

```
# role now carries the analysis actions
$ aws iam get-role-policy ... | grep textract
  textract:StartDocumentAnalysis   ✅ present
  textract:GetDocumentAnalysis     ✅ present

# real job, real 170KB PDF already in the uploads bucket
$ aws lambda invoke --function-name ...RapExtractFunction... 
{
  "status": "failed",
  "error": "... is not authorized to perform: textract:StartDocumentAnalysis
             with an explicit deny in a service control policy: ... p-9n6l6a99"
}
```

Failure in <1s, before any Bedrock call. **The IAM fix is necessary but not sufficient.** `ca`
was reverted to `EXTRACTION_IMPL=mock` immediately afterward so the demo stage is not left
failing outright — a canned result is a better demo failure mode than a hard error.

---

## There is no in-repo workaround

| Engine | Needs Textract analysis? | Usable on `ca`? |
| --- | --- | --- |
| `bda` (Bedrock Data Automation) | no | **no** — BDA runtime is `us-east-1` only; the `ca-central-1` control plane accepts a project but `InvokeDataAutomationAsync` fails on the profile ARN |
| `bedrock` (Textract LAYOUT → Claude) | **yes** | blocked by the SCP |
| `mock` | no | not extraction |

The `bedrock` engine is the *only* in-country-at-rest path and the only one carrying verbatim
quotes with read (not guessed) page numbers — so this SCP is not merely blocking a backup, it is
blocking the residency story. The one Textract-free route in the code is `.txt` with
`ALLOW_UNGROUNDED_TXT=1`, which `loadDocumentText` refuses by default precisely because it
destroys page grounding; it is a diagnostic hatch, not a fallback.

---

## What to ask for

There is no way around this from the repo, so it is an external ask. The org administrator
(**derekja@uvic.ca**, management account `123896930307`) needs to permit **Textract for the
member account's service roles**, not just for SSO principals — both action families are
currently denied:

- `textract:StartDocumentAnalysis` + `textract:GetDocumentAnalysis` (what the LAYOUT path uses)
- `textract:StartDocumentTextDetection` + `textract:GetDocumentTextDetection` (the fallback,
  also denied — see below)

in `ca-central-1`. Everything on our side is already in place: the IAM grant in this PR covers
all four actions, and flipping `EXTRACTION_IMPL=bedrock` on the `ca` deploy is then the only
remaining step.

Useful framing for the ask: this is not a request to open Textract to the account — a human SSO
session can already call it. It is a request to stop denying it to the account's *Lambda
execution roles*, which is what makes the difference between "a developer can OCR a document by
hand" and "the product can."

### The cheaper workaround was tested and does NOT exist

Before escalating we tested whether the SCP covers only the *analysis* APIs, which would have
let us dodge it in code by switching the OCR stage to async text detection. **It does not.**

An `OCR_MODE=text` branch was written (swapping `StartDocumentTextDetection` /
`GetDocumentTextDetection` for the analysis pair, with a `LINE`-block text builder that keeps the
`[p.N]` page markers), deployed to `ca`, and invoked against the same real PDF:

```
"error": "... is not authorized to perform: textract:StartDocumentTextDetection
           with an explicit deny in a service control policy: ... p-9n6l6a99"
```

Same policy, same principal, different action family. So the deny is **broad across Textract**
for service roles, not scoped to the analysis actions. There is no in-code route around it.

The `OCR_MODE` branch was **reverted** rather than merged: its only purpose was to dodge this
SCP, it cannot, and an untested degraded OCR path in the tree would be a liability — someone
would eventually set it expecting it to help. The measurement is recorded here instead. If the
SCP is ever partially lifted, the shape of that change is in this PR's history.

---

## Related: the same silent-degradation shape, twice

`pipeline.ts:18` is a bare `return runExtractionMock(input)` fallthrough. Any unset, misspelled,
or unrecognized `EXTRACTION_IMPL` silently becomes the mock — a deploy that forgets the variable
serves fake extractions with no warning. This is the same failure shape documented in
`docs/notifications-delivery-status.md`, where empty `DIGEST_*` vars silently degrade email to
`skipped`. Both are deploy-time env vars with a quiet default. Neither is a bug on its own;
together they are a pattern worth a deliberate decision about whether "quietly serve something
plausible" is the right default for this project.

---

## Result — `ca` has a working in-country extraction path (2026-07-27)

The SCP is still in force and Textract is still unavailable. Rather than wait on it, the OCR stage was
replaced with a loader that reads the PDF's **own embedded text layer**, which needs no AWS text service
at all. Design: `docs/superpowers/specs/2026-07-27-textract-free-extraction-design.md`.

**Measured live on the `ca` stage** against the 22-entry gold set
(`scripts/fixtures/gold-commitments-bankofcanada.json`), real Bank of Canada RAP, 17 pages:

```
gold commitments:      22
extracted commitments: 25
action matches:        22/22
PAGE matches:          22/22   <-- the acceptance bar
validation issues:     5
```

For reference the Textract→Claude path scored 26 commitments and BDA 22 on this same document, so recall
is unchanged while the OCR dependency is gone. Offline, the text-layer output shares **99.0%** of the
Textract path's vocabulary on p13/p15 (`scripts/measure-textlayer-parity.ts`); the only divergences are
apostrophe encoding.

**Page grounding — the property that mattered — holds.** The pre-work baseline recovered gold action text
verbatim but attributed it to page 12 where gold says 13. All 22 now land on their correct physical page.

### What the five validation issues are

All `quote_not_found`, and **none of them on a commitment's action or quote** — four on `pillarRaw` (a
section heading) and one on `publicationDate`. The commitments themselves validated clean. The likely
cause is a quote spanning a paragraph boundary, where the `[p.N]` marker between paragraphs lands inside
the quote and breaks the substring check. The direction is safe — a false flag routes to human review and
can never produce wrong provenance — but it is unfixed. Worth a follow-up.

### `ca` is deployed with

```
EXTRACTION_IMPL=bedrock  DOC_LOADER=textlayer
```

Any future `sst deploy --stage ca` must re-export **both**, plus `DIGEST_SENDER` / `DIGEST_RECIPIENT`,
or extraction silently reverts to the mock and email silently reverts to `skipped`.

### Known limitations, carried deliberately

- **A table whose columns are all wide and wordy** still passes the prose-likeness guard, would be read
  column-major, and would lose the pairing between a commitment and its measure — **with no validation
  flag**. This is the one failure mode here that produces no signal. Re-measured 2026-07-27 across seven
  documents: no such page occurs in any of them, so the risk is **untested, not disproven**.
- **Scanned documents fail in region** by design. No cross-border fallback was added.
- The loader has since been measured against **7 documents / 166 pages** —
  `docs/rap-textlayer-corpus-measurement.md`. The gates held (no false positives; the fidelity gate
  caught real Ghostscript ligature corruption in a derived RBC file). The column constant did not:
  `COLUMN_GUTTER_RATIO = 0.12` has **no plateau** outside Bank of Canada, so column reordering is
  validated on that one document and merely characterised on the other six.
- The **gold corpus** is still n=1. That is now the binding constraint on further tuning: a second gold
  set has to be human-verified, because scoring the extractor against its own output measures nothing.

The SCP escalation above still stands: Textract remains the better OCR path for scanned documents, and
this work does not replace the need to ask for it.
