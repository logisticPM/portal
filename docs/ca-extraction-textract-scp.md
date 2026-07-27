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

To unblock `ca` extraction, the org administrator (**derekja@uvic.ca**) needs to permit, for the
member account's **service roles** and not just SSO principals:

- `textract:StartDocumentAnalysis`
- `textract:GetDocumentAnalysis`

in `ca-central-1`. Everything on our side is then already in place.

### Open question worth one experiment first

We did **not** establish whether the SCP denies *all* of Textract or only the analysis APIs.
`textract:StartDocumentTextDetection` is granted in IAM and was never exercised from the Lambda
role. If the SCP denies only the analysis actions, switching the OCR stage to the async
text-detection API might dodge it entirely with no external dependency — at a real cost:
the LAYOUT path was adopted deliberately because a flat `LINE` join carries no paragraph
boundaries, so `chunkDocument`'s paragraph split never fires (see the comment at
`pipeline.bedrock.ts:196-201`). Worth measuring before asking, since it may make the ask
unnecessary.

---

## Related: the same silent-degradation shape, twice

`pipeline.ts:18` is a bare `return runExtractionMock(input)` fallthrough. Any unset, misspelled,
or unrecognized `EXTRACTION_IMPL` silently becomes the mock — a deploy that forgets the variable
serves fake extractions with no warning. This is the same failure shape documented in
`docs/notifications-delivery-status.md`, where empty `DIGEST_*` vars silently degrade email to
`skipped`. Both are deploy-time env vars with a quiet default. Neither is a bug on its own;
together they are a pattern worth a deliberate decision about whether "quietly serve something
plausible" is the right default for this project.
