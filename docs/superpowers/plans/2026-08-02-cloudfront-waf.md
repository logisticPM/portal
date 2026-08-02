# CloudFront WAF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a minimal AWS WAFv2 WebACL (rate limit + AWS managed CommonRuleSet + KnownBadInputs) to the portal's CloudFront distribution, on `observe` stages only, deployed Count-first.

**Architecture:** One raw `aws.wafv2.WebAcl` (CLOUDFRONT scope, created via a us-east-1 provider), associated to the `Nextjs("Web")` distribution through a new `transform.cdn`. Everything lives in `sst.config.ts`; no app code, no new dependency. Rules start in COUNT mode behind a `wafBlocking` flag.

**Tech Stack:** SST v4 (Ion) + Pulumi AWS provider (the SST-injected global `aws`), TypeScript.

## Global Constraints

- **Only `observe` stages** (`isCa || isProd`, already defined at `sst.config.ts:208`) get the WebACL — same gate as the DLQ/X-Ray/alarms. Non-observe stages must be unchanged (no WebACL, no provider cost).
- **CLOUDFRONT-scoped WebACL must be created in us-east-1** — via a dedicated `aws.Provider` regardless of stack region (prod is us-east-1; `ca` is ca-central-1).
- **Count-first:** `const wafBlocking = process.env.WAF_BLOCKING === "true"` — default `false`. Managed groups use `overrideAction: { count: {} }` and the rate rule `action: { count: {} }` until `wafBlocking` is true.
- **Rate limit:** `1000` requests / 5-min / IP, `aggregateKeyType: "IP"`.
- **Rules & priorities:** RateLimit (1), AWSManagedRulesCommonRuleSet (2), AWSManagedRulesKnownBadInputsRuleSet (3). `defaultAction: allow`.
- **No full-request logging** in this plan (metrics + sampled requests only).
- Raw AWS resources use the **global `aws`** (no import), matching `new aws.sqs.Queue` / `new aws.cloudwatch.MetricAlarm` already in the file.
- The `webAcl` variable must be declared **before** `new sst.aws.Nextjs("Web")` (currently `sst.config.ts:543`) so the `transform.cdn` can reference it.
- Two "verify against the installed SST/pulumi version" points (the repo already carries such warnings): the `transform.cdn` arg name (`webAclId`) and the wafv2 rule field shapes.

Spec: `docs/superpowers/specs/2026-08-02-cloudfront-waf-design.md`.

## File Structure

- **Modify** `sst.config.ts` — (a) provider + `wafBlocking` + `WebAcl` inserted right after the `observe` gate (~line 208); (b) `transform.cdn` added to the `Nextjs("Web")` component (~line 546).
- **Modify** `docs/deploy.md` — a short "WAF / edge protection" section.

No test file — declarative infra, no unit-testable pure logic. Per-task offline gate is `tsc` + `next build`; live verification (deploy + AWS CLI) is in the final section.

---

## Task 1: Create the WebACL (provider + flag + resource)

**Files:**
- Modify: `sst.config.ts` (insert after the `observe` definition, ~line 208)

**Interfaces:**
- Produces: `wafUsEast1: aws.Provider | undefined`, `wafBlocking: boolean`, `webAcl: aws.wafv2.WebAcl | undefined` — all in the `run()` scope, visible to the `Nextjs("Web")` component below. Task 2 consumes `webAcl`.

- [ ] **Step 1: Insert the provider, flag, and WebACL**

In `sst.config.ts`, immediately after line 208 (`const observe = isCa || isProd;`), insert:

```ts
    // --- Edge protection: AWS WAF on the CloudFront distribution -------------
    // (design: docs/superpowers/specs/2026-08-02-cloudfront-waf-design.md).
    // CLOUDFRONT-scoped WebACLs must be created in us-east-1, so use a dedicated
    // provider regardless of the stack region (prod is us-east-1; ca is
    // ca-central-1). observe-gated so dev/mock stages get nothing.
    const wafUsEast1 = observe ? new aws.Provider("WafUsEast1", { region: "us-east-1" }) : undefined;
    // Count-first: every rule starts in COUNT mode (nothing blocked) so we can
    // watch sampled requests for false positives, then flip to blocking by
    // setting WAF_BLOCKING=true (or changing this default in a follow-up PR).
    const wafBlocking = process.env.WAF_BLOCKING === "true";
    const managedOverride = wafBlocking ? { none: {} } : { count: {} };
    const rateAction = wafBlocking ? { block: {} } : { count: {} };
    const vis = (name: string) => ({
      cloudwatchMetricsEnabled: true,
      sampledRequestsEnabled: true,
      metricName: name,
    });
    const webAcl = observe
      ? new aws.wafv2.WebAcl(
          "WebAcl",
          {
            scope: "CLOUDFRONT",
            defaultAction: { allow: {} },
            visibilityConfig: vis(`indigenomics-${$app.stage}-waf`),
            rules: [
              {
                name: "RateLimit",
                priority: 1,
                action: rateAction,
                statement: { rateBasedStatement: { limit: 1000, aggregateKeyType: "IP" } },
                visibilityConfig: vis(`indigenomics-${$app.stage}-waf-ratelimit`),
              },
              {
                name: "CommonRuleSet",
                priority: 2,
                overrideAction: managedOverride,
                statement: {
                  managedRuleGroupStatement: { vendorName: "AWS", name: "AWSManagedRulesCommonRuleSet" },
                },
                visibilityConfig: vis(`indigenomics-${$app.stage}-waf-common`),
              },
              {
                name: "KnownBadInputs",
                priority: 3,
                overrideAction: managedOverride,
                statement: {
                  managedRuleGroupStatement: { vendorName: "AWS", name: "AWSManagedRulesKnownBadInputsRuleSet" },
                },
                visibilityConfig: vis(`indigenomics-${$app.stage}-waf-knownbad`),
              },
            ],
          },
          // Both webAcl and wafUsEast1 are observe-gated together, so the provider
          // is defined whenever this resource is created.
          { provider: wafUsEast1! },
        )
      : undefined;
```

Notes for the implementer:
- A rate-based statement uses `action`; a managed-rule-group statement uses `overrideAction` — do not swap them.
- If `tsc` rejects any wafv2 field name (e.g. `visibilityConfig`/`cloudwatchMetricsEnabled` casing) against the installed pulumi-aws types, adjust to the type the compiler expects and keep the same values — this is one of the two version-verify points.

- [ ] **Step 2: Typecheck**

Run: `cd portal && npx tsc --noEmit`
Expected: no errors. (`sst.config.ts` is excluded from `npm run typecheck`'s tsconfig, so run `tsc` directly on it if needed — see Step 4; the goal is that the file has no type errors against `.sst/platform` types.)

- [ ] **Step 3: Build**

Run: `cd portal && REPO_IMPL=mock npx next build`
Expected: build succeeds (this catches nothing WAF-specific but confirms the config edit didn't break the app build the way CI runs it).

- [ ] **Step 4: Validate the SST config parses**

Run: `cd portal && npx sst diff --stage ca 2>&1 | head -40` (requires `AWS_PROFILE=isb` + SSO login; if unavailable in this environment, skip and note it).
Expected: SST loads the config without a syntax/type error and shows a plan that **creates `WebAcl` + `WafUsEast1`** (no error like "unknown resource field"). If `sst diff` can't run here, at minimum Steps 2–3 must pass and the reviewer verifies the resource shape by reading.

- [ ] **Step 5: Commit**

```bash
cd portal
git add sst.config.ts
git commit -m "feat(infra): add CloudFront WAF WebACL (count-first, observe stages)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Associate the WebACL with the CloudFront distribution

**Files:**
- Modify: `sst.config.ts` (the `Nextjs("Web")` `transform` block, ~line 546)

**Interfaces:**
- Consumes: `webAcl` from Task 1.
- Produces: the Web distribution's `webAclId` set to `webAcl.arn` on `observe` stages.

- [ ] **Step 1: Add `cdn` to the transform block**

In `sst.config.ts`, the `Nextjs("Web")` `transform` block currently contains only `server: { … }`. Add a `cdn` transform after the `server` block (inside the same `transform: { … }` object):

```ts
        // Attach the WAF WebACL (observe stages only) to the CloudFront
        // distribution. CLOUDFRONT association is by the WebACL ARN. Verify the
        // arg name (webAclId) against the installed SST version.
        cdn: (args: any) => {
          if (webAcl) args.webAclId = webAcl.arn;
        },
```

The result should read:

```ts
      transform: {
        server: {
          /* …unchanged… */
        },
        cdn: (args: any) => {
          if (webAcl) args.webAclId = webAcl.arn;
        },
      },
```

The `if (webAcl)` guard makes this a no-op on non-observe stages (where `webAcl` is `undefined`), so the distribution has no WebACL there.

- [ ] **Step 2: Typecheck**

Run: `cd portal && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Build**

Run: `cd portal && REPO_IMPL=mock npx next build`
Expected: build succeeds.

- [ ] **Step 4: Preview the association (if AWS is available)**

Run: `cd portal && AWS_PROFILE=isb npx sst diff --stage ca 2>&1 | head -60`
Expected: the plan shows the `Web` CloudFront distribution being **updated** with a `webAclId`. If `sst diff` isn't runnable here, note it — live verification covers it.

- [ ] **Step 5: Commit**

```bash
cd portal
git add sst.config.ts
git commit -m "feat(infra): associate the WAF WebACL with the Web CloudFront distribution

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Document the WAF in the deploy guide

**Files:**
- Modify: `docs/deploy.md`

**Interfaces:** none (docs only).

- [ ] **Step 1: Add a "WAF / edge protection" section**

Append to `docs/deploy.md` a concise section covering:

```markdown
## WAF / edge protection

A WAFv2 WebACL is attached to the Web CloudFront distribution on the `ca` and `production`
stages (`observe`). Rules: a rate-based limit (1,000 requests / 5-min / IP) plus the AWS managed
`CommonRuleSet` and `KnownBadInputsRuleSet`. The WebACL is CLOUDFRONT-scoped and created in
`us-east-1` (via a dedicated provider) regardless of the stack's region.

**Count-first.** Rules ship in COUNT mode — nothing is blocked; requests that *would* be blocked
are only counted (watch `AWS/WAFV2` metrics + sampled requests in the WAF console, us-east-1).
To turn on blocking, deploy with `WAF_BLOCKING=true` (or flip the default in `sst.config.ts`)
after count-mode data looks clean (~1–2 days).

**Org SCP note.** CLOUDFRONT WAF create/associate may be denied by the org SCP for the deploy
role (the account is a member of an org owned by derekja@uvic.ca; the known SCP denies service
roles — see the Textract precedent). `ca` deploys via the SSO role (fine); if a `production`
deploy fails on `wafv2:CreateWebACL` / `cloudfront:UpdateDistribution`, ask Derek to permit those
actions for `AWS_DEPLOY_ROLE_ARN`.

**Cost.** ≈ $8/mo per stage ($5 WebACL + ~$3 rules) + $0.60 / million requests.
```

- [ ] **Step 2: Commit**

```bash
cd portal
git add docs/deploy.md
git commit -m "docs: document the CloudFront WAF (count-first, SCP note, cost)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Live verification & rollout (after the tasks; not unit-testable)

**`ca` first** (SSO role — expected to succeed):
1. `cd portal && AWS_PROFILE=isb npm run ca:deploy`.
2. `AWS_PROFILE=isb aws wafv2 list-web-acls --scope CLOUDFRONT --region us-east-1` → the new ACL appears.
3. `AWS_PROFILE=isb aws wafv2 list-resources-for-web-acl --web-acl-arn <arn> --region us-east-1` (or `aws cloudfront get-distribution-config` → `WebACLId`) → shows the `ca` distribution associated.
4. Load the `ca` site (`/`, `/extract`) → still serves normally (count mode blocks nothing).
5. After some traffic, `AWS/WAFV2` `CountedRequests` metric + sampled requests are populated.

**prod** (merge → CI/CD auto-deploy, GitHub OIDC role): either the deploy succeeds (WebACL created + associated) or it **fails fast** on an SCP deny — prod's running resources are untouched. If denied, capture the exact `AccessDenied`/SCP error and escalate to **derekja@uvic.ca**, asking to permit `wafv2:CreateWebACL`, `wafv2:UpdateWebACL`, `wafv2:AssociateWebACL`, `wafv2:GetWebACL`, `wafv2:ListWebACLs`, and `cloudfront:UpdateDistribution` (with `webACLId`) for `AWS_DEPLOY_ROLE_ARN`.

**Phase 2 (blocking):** after ~1–2 days of clean count-mode data, deploy with `WAF_BLOCKING=true` (or a one-line default flip) → re-verify the site serves and `BlockedRequests` reflects only abusive traffic. If a managed rule counts legit traffic, add a `ruleActionOverrides` exclusion for that specific sub-rule before flipping.

## Self-Review

- **Spec coverage:** us-east-1 provider → Task 1; WebACL rules/rate-limit/count-first → Task 1; `observe` gating → Task 1 (+ Task 2 guard); CloudFront association via `transform.cdn` → Task 2; docs note + SCP escalation + cost → Task 3 + live section; build+fail-fast rollout + Derek escalation → live section. No spec item unmapped.
- **Placeholder scan:** none — every step has concrete code or an exact command.
- **Type consistency:** `webAcl` / `wafUsEast1` / `wafBlocking` are defined in Task 1 and consumed by name in Task 2; `webAcl.arn` is the association value in both the spec and Task 2.
