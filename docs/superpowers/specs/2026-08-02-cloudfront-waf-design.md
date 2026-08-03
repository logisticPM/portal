# Design: AWS WAF on the portal's CloudFront distribution

**Date:** 2026-08-02
**Branch:** `feat/cloudfront-waf` (off `main` @ 9b4efb9)

## Context

`docs/PROJECT-AUDIT.md` (recommendation #5, "sandbox → production hardening") flags that the
portal's CloudFront distribution has **no WAF** today. The app is a public, Bedrock-backed
Next.js site — unauthenticated read surface plus a login — so it has the two classic exposures a
WAF addresses: common web exploits (OWASP-style probes, known-bad payloads) and volumetric
abuse. This design adds a minimal, cost-aware AWS WAFv2 WebACL to the distribution.

Verified before designing:
- **No WebACL exists** — `aws wafv2 list-web-acls --scope CLOUDFRONT --region us-east-1`
  (via the `isb` SSO role) returns `WebACLs: []`, and the read is **not** SCP-denied.
- **The org SCP is principal-conditional.** Account `106189426706` is a member of org
  `o-k5jncqbs7x` (management account `123896930307`, owned by **derekja@uvic.ca**). The known
  SCP (`p-9n6l6a99`) denies actions to *service/Lambda roles* while allowing the developer SSO
  role (`AWSReservedSSO_myisb_IsbUsersPS`) — this is documented for Textract
  ([[textract-scp-block-and-org-owner]]). SCP contents are unreadable from the member account.
  So whether **wafv2 create/associate** is permitted for the **prod deploy role** (GitHub OIDC,
  `AWS_DEPLOY_ROLE_ARN`) is unknown; the `ca` deploy uses the SSO role and is very likely fine.
- **CloudFront is global edge**, so a WAF does not split the app or move data residency
  ([[data-governance-ocap-residency]]). Only WAF *logging* would capture request metadata — this
  design does not enable it in Phase 1 (see §5).

## Decisions (from brainstorming)

- **Org-owner gate:** *build + fail-fast* — deploy to `ca` first (SSO role), then prod (OIDC
  role); if prod is SCP-denied it fails fast and we escalate to Derek with the exact denied
  actions. (Not: ask up front.)
- **Rule set:** baseline — managed CommonRuleSet + KnownBadInputsRuleSet + one rate-based rule.
- **Rate limit:** 1,000 requests / 5-min / IP.
- **Rollout mode:** Count-first, then flip to Block.
- **Logging:** metrics + sampled requests only in Phase 1 (no full-request logging).

## Non-goals

- No Bot Control, no IP reputation list, no geo-restriction, no IP allow/deny (can be added later).
- No full-request WAF logging in Phase 1 (avoids the `ca` residency question and extra cost).
- No custom domain / ACM work (separate hardening item).
- No app-code change and no new npm dependency — this is entirely `sst.config.ts`.
- Does not touch dev/mock stages — WAF is gated to `observe` stages only.

## Scope / gating

Create the WebACL only on **`observe` stages** (`isCa || isProd`, already defined in
`sst.config.ts`) — the same gate the DLQ, X-Ray, alarms, and dashboard use. Non-observe stages
(local/mock/ephemeral) get no WAF, so they stay free and uncluttered.

## Component 1 — us-east-1 provider alias

A CLOUDFRONT-scoped WebACL must be created against **us-east-1**. Prod's stack region is already
us-east-1, but `ca`'s is ca-central-1, so a stage-independent us-east-1 provider is needed:

```ts
const wafUsEast1 = new aws.Provider("WafUsEast1", { region: "us-east-1" });
```

Attach it to the WebACL (harmless on prod, required on `ca`). Uses the SST-injected global `aws`
(same pattern as the existing `new aws.sqs.Queue` / `new aws.cloudwatch.MetricAlarm`).

## Component 2 — the WebACL

`new aws.wafv2.WebAcl("WebAcl", {...}, { provider: wafUsEast1 })`, gated on `observe`:

- `scope: "CLOUDFRONT"`, `defaultAction: { allow: {} }`.
- `visibilityConfig`: `cloudwatchMetricsEnabled: true`, `sampledRequestsEnabled: true`,
  `metricName: \`indigenomics-${$app.stage}-waf\``.
- **Rules** (each with its own `visibilityConfig` metric):
  1. **RateLimit** (priority 1) — `rateBasedStatement { limit: 1000, aggregateKeyType: "IP" }`.
     Action gated by `wafBlocking` (§3): `{ block: {} }` when blocking, else `{ count: {} }`.
     Rationale: uploads go **direct to S3** via presigned PUT (not through CloudFront/WAF) and
     extraction is behind the indigenomics auth gate, so the Bedrock-cost path is already
     auth-limited; this rule mainly shields the public read/login surface from volumetric abuse.
  2. **CommonRuleSet** (priority 2) — `managedRuleGroupStatement { vendorName: "AWS",
     name: "AWSManagedRulesCommonRuleSet" }`. `overrideAction` gated by `wafBlocking`:
     `{ none: {} }` (use the group's own actions = block) when blocking, else `{ count: {} }`.
  3. **KnownBadInputs** (priority 3) — same shape with
     `name: "AWSManagedRulesKnownBadInputsRuleSet"`.

**Managed-rule caveat to verify at implement-time:** `CommonRuleSet` includes
`SizeRestrictions_BODY` (blocks bodies > 8KB). The app's form posts / server actions are small
and PDF uploads bypass CloudFront, so this should be safe — but Count-first (§3) is precisely how
we confirm it before any blocking.

## Component 3 — Count-first flag

```ts
const wafBlocking = process.env.WAF_BLOCKING === "true"; // Phase 1 default: false → count-only
```

Phase 1 deploys with `wafBlocking` false: every rule runs in **count** mode, so nothing is
blocked and we observe `AllowedRequests` / `CountedRequests` metrics + sampled requests for false
positives. Phase 2 flips to blocking — either by setting `WAF_BLOCKING=true` at deploy or (cleaner
for review) a one-line PR changing the default — after ~1–2 days of clean count-mode data.

## Component 4 — associate with the CloudFront distribution

Extend the existing `Nextjs("Web")` `transform` block (which already has `server`) with `cdn`:

```ts
transform: {
  server: { /* unchanged */ },
  cdn: (args: any) => {
    if (webAcl) args.webAclId = webAcl.arn; // CLOUDFRONT association = distribution web_acl_id
  },
},
```

`webAcl` is created only on `observe` stages, so on other stages the transform is a no-op and the
distribution has no WebACL. **Verify the SST v4 `transform.cdn` arg name** (`webAclId` vs
`web_acl_id`) against the installed version at implement-time — the repo already carries
"verify against the installed SST version" warnings for transform shapes.

## Data flow

```
viewer → CloudFront distribution (global edge)
             │  WebACL (us-east-1, CLOUDFRONT scope) evaluates each request:
             │    RateLimit → CommonRuleSet → KnownBadInputs
             │    Phase 1: count only (metrics + sampled requests)
             │    Phase 2: block on match
             ▼
        origin Lambda (Next.js) → DynamoDB / Bedrock / S3
```

## Error handling / the org-owner escalation

- **`ca` deploy** (SSO role): expected to succeed — WAFv2 reads already work for this principal.
- **prod deploy** (GitHub OIDC role): if the SCP denies `wafv2:CreateWebACL` /
  `wafv2:AssociateWebACL` / `cloudfront:UpdateDistribution` (webACLId) for that role, the SST
  deploy **fails fast** on that resource. Existing prod resources are untouched (pulumi stops at
  the failed resource; it does not tear down the running stack). Capture the error and escalate to
  **derekja@uvic.ca**, asking to permit these actions for the account's **deploy roles**
  (`AWS_DEPLOY_ROLE_ARN`), framed like the Textract ask: a human SSO session can already call
  wafv2 — what's needed is the same for the deploy role.
- **False positives in Count mode:** observed via sampled requests before any blocking — the whole
  point of Phase 1. If a managed rule counts legitimate traffic, exclude that specific rule
  (`ruleActionOverrides`) before flipping to block.

## Files

- `sst.config.ts` — us-east-1 provider alias, `wafBlocking` flag, `aws.wafv2.WebAcl` (gated on
  `observe`), and the `transform.cdn` association on `Nextjs("Web")`.
- `docs/deploy.md` — a short "WAF / edge protection" note (rules, count-first, how to flip to
  block, the Derek escalation, cost).

No test file: this is declarative infra with no unit-testable pure logic. Verification is by
deploy + AWS CLI/console checks (below).

## Verification

**Offline:** `npx tsc --noEmit`; `npx next build` (mock) — confirms the config still type-checks
and builds. `npx sst diff --stage ca` (optional) to preview the WebACL + distribution change.

**Live on `ca`** (`AWS_PROFILE=isb npm run ca:deploy`):
1. `aws wafv2 list-web-acls --scope CLOUDFRONT --region us-east-1` shows the new ACL.
2. `aws wafv2 list-resources-for-web-acl --web-acl-arn <arn> --region us-east-1` (or the
   distribution's `WebACLId` via `aws cloudfront get-distribution-config`) shows the association.
3. The `ca` site still serves normally (`/`, `/extract`), confirming count-mode blocks nothing.
4. After some traffic, `AWS/WAFV2` metrics (`CountedRequests`) and sampled requests are populated.

**Live on prod** (merge → CI/CD auto-deploy): either the deploy succeeds (WebACL created +
associated) or it fails fast on an SCP deny → escalate to Derek (above).

**Phase 2 (blocking):** after ~1–2 days of clean count-mode data, flip `wafBlocking` → redeploy →
re-verify the site serves and `BlockedRequests` reflects only abusive traffic.

## Rollout

1. Implement on `feat/cloudfront-waf`; offline checks.
2. `ca:deploy` (SSO) → verify association + count-mode.
3. PR → squash-merge → prod auto-deploys; if SCP-denied, escalate to Derek, otherwise verify.
4. `ca:deploy` again from `main` if needed so both stages match.
5. Follow-up PR flips `wafBlocking` to block once count-mode data is clean.

No infra dependency beyond the org-SCP question; no new npm package; cost ≈ $8/mo per `observe`
stage + $0.60/M requests, credit-covered.
