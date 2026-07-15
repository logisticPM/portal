# RAP Index Evidence-Precedence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an opted-in company surface its uploaded RAP data on the public Index, and make the "confirmed" metric real, all governed by one precedence rule — `confirmed > research > self-reported` — with self-report visible but never ranking.

**Architecture:** A new pure resolver in `src/lib/index-evidence/` turns each org's commitments into `EvidenceRow`s at read time. It reuses the crosswalk's BN key (already on `Commitment.businessNumber`) to (a) project the org's `RapData` uploads as badged, non-ranking self-reported rows when the org opted in, and (b) bridge supplier `Confirmation`s (via `Coverage`) into a `confirmed` tier for procurement commitments. Nothing is copied between domains; opt-out flips a flag on `OrgClaim`.

**Tech Stack:** TypeScript, Next.js App Router, DynamoDB, `tsx` for scripts/tests. No test framework — tests are `scripts/test-*.ts` via `npx tsx`.

## Global Constraints

- **No new test framework.** Tests are `scripts/test-<name>.ts` run with `npx tsx`, using a local `check(name, ok)` helper (✅/❌ tally, `process.exit(fail ? 1 : 0)`). Pure logic uses injected fakes / the in-memory mock repos — no DynamoDB.
- **Verification gates.** Every task touching app/runtime code ends by confirming `npm run typecheck` and `npm run build` pass.
- **Precedence rule (the spec's core):** a commitment's public status = the most independent evidence available, `confirmed > research > self-reported`. Self-reported rows are **always `ranks: false`** (never move an org's headline `avgProgress` or leaderboard). Only an independent supplier confirmation raises a commitment to `confirmed`.
- **Read-time projection, not a copy.** The resolver never writes to the commitments domain and nothing is copied between domains. Opt-out = the flag flips and projected rows vanish next render.
- **Confirmation bridge is org-level, procurement-only (v1).** Confirmed procurement spend (`Coverage.byFlow.procurement.confirmed`) for the parties claiming an org's BN elevates that org's `procurement` commitments to `confirmed`, and the resolver carries the actual confirmed **$** for display (never a per-commitment allocation).
- **Domain isolation.** The commitments and RAP domains never import each other; all cross-domain fan-out lives in `src/lib/identity/` or `src/lib/index-evidence/`. The economic-flow repo (`@/lib/repo`) may be read from the evidence module only.
- **Opt-in is per-organization**, stored on `OrgClaim` (`showcaseOptIn`), toggled by the claimed company on `/my-rap`, off by default (consent explicit).
- **Depends on the merged crosswalk:** `Commitment.businessNumber`, `resolveOrgForParty`, `listCommitmentsForBNs` already exist on `main`.

---

## File Structure

- `src/lib/rap/types.ts` — **modify.** Add `showcaseOptIn?`/`showcaseOptInAt?` to `OrgClaim`; add `listClaimsByBN(bn)` to the repo interface.
- `src/lib/dynamo/rap-table.ts` — **verify only.** `toClaimItem` spreads `...c` and `itemToClaim` uses `strip()`, so the new fields round-trip with no change (a test proves it).
- `src/lib/rap/repo.mock.ts`, `src/lib/rap/repo.dynamo.ts` — **modify.** Implement `listClaimsByBN(bn)` (dynamo: Query `PK = ORGCLAIM#<bn>`).
- `src/lib/rap/actions-core.ts` — **modify.** Add `setShowcaseOptInForParty` (testable core).
- `src/lib/rap/actions.ts` — **modify.** Add `setShowcaseOptInAction` server action.
- `src/app/my-rap/page.tsx` — **modify.** Opt-in toggle.
- `src/lib/index-evidence/status-map.ts` — **create.** `rapStatusToDisplay`.
- `src/lib/index-evidence/readers.ts` — **create.** `EvidenceDeps` interface + concrete `evidenceDeps` adapter over rap/repo/identity.
- `src/lib/index-evidence/resolver.ts` — **create.** `resolveOrgEvidence` (pure) + `EvidenceRow`/`EvidenceTier` types.
- `src/lib/index-evidence/index.ts` — **create.** Barrel.
- `src/lib/commitments/orgs.ts` — **modify.** `rollupOne` `confirmedPct` driven by the resolver's confirmed tier (over confirmable rows).
- `src/app/commitments/page.tsx`, `src/app/organizations/[id]/page.tsx` — **modify.** Render confirmed badge (+$) and projected self-reported rows (badged, non-ranking).
- `scripts/test-*.ts` — **create per task.**

---

## Task 1: `OrgClaim.showcaseOptIn` schema + round-trip + `listClaimsByBN`

**Files:**
- Modify: `src/lib/rap/types.ts:267-273` (`OrgClaim`), `:419-423` (repo interface)
- Modify: `src/lib/rap/repo.mock.ts`, `src/lib/rap/repo.dynamo.ts`
- Test: `scripts/test-orgclaim-optin.ts`

**Interfaces:**
- Produces: `OrgClaim.showcaseOptIn?: boolean`, `OrgClaim.showcaseOptInAt?: string`; `rapRepo.listClaimsByBN(bn: string): Promise<OrgClaim[]>` (granted claims on a BN).

- [ ] **Step 1: Write the failing test**

Create `scripts/test-orgclaim-optin.ts`:
```ts
import { rapRepo } from "../src/lib/rap";
import { toClaimItem, itemToClaim } from "../src/lib/dynamo/rap-table";
import type { OrgClaim } from "../src/lib/rap/types";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean) => { console.log(`${ok ? "✅" : "❌"} ${n}`); ok ? pass++ : fail++; };

const claim = (over: Partial<OrgClaim> = {}): OrgClaim => ({
  businessNumber: "890561467", partyId: "c-acme", status: "granted",
  attestedAt: "2026-07-15T00:00:00.000Z", grantedBy: "system:bn-verify", ...over,
});

async function main() {
  // round-trip: showcaseOptIn survives the Dynamo item mapping (strip-based)
  const rt = itemToClaim(toClaimItem(claim({ showcaseOptIn: true, showcaseOptInAt: "2026-07-15T01:00:00.000Z" })));
  check("showcaseOptIn round-trips", rt.showcaseOptIn === true && rt.showcaseOptInAt === "2026-07-15T01:00:00.000Z");

  // listClaimsByBN returns granted claims on that BN (mock repo)
  await rapRepo.putClaim(claim({ partyId: "c-acme", businessNumber: "890561467", showcaseOptIn: true }));
  await rapRepo.putClaim(claim({ partyId: "c-other", businessNumber: "890561467" }));
  await rapRepo.putClaim(claim({ partyId: "c-acme", businessNumber: "710477720" }));
  const byBn = await rapRepo.listClaimsByBN("890561467");
  check("listClaimsByBN returns both parties on the BN", byBn.length === 2 && byBn.every((c) => c.businessNumber === "890561467"));
  check("listClaimsByBN excludes other BNs", (await rapRepo.listClaimsByBN("710477720")).length === 1);
  process.exit(fail ? 1 : 0);
}
main();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-orgclaim-optin.ts`
Expected: FAIL — `listClaimsByBN` not a function / `showcaseOptIn` not on `OrgClaim`.

- [ ] **Step 3: Extend the type + repo interface**

In `src/lib/rap/types.ts`, add to `interface OrgClaim`:
```ts
  showcaseOptIn?: boolean;   // company opted this org in to public-Index surfacing
  showcaseOptInAt?: string;  // ISO 8601 — when the opt-in was last set
```
add to the repo interface (near `listClaimsByParty`, ~line 423):
```ts
  listClaimsByBN(bn: string): Promise<OrgClaim[]>;
```

- [ ] **Step 4: Implement `listClaimsByBN` in both repos**

In `src/lib/rap/repo.mock.ts`, alongside `listClaimsByParty`:
```ts
  async listClaimsByBN(bn: string) {
    return this.claims.filter((c) => c.businessNumber === bn && c.status === "granted");
  },
```
> Match the mock's existing claim-store field name — if `listClaimsByParty` filters `store`/`this.claims`/a module array, mirror exactly that.

In `src/lib/rap/repo.dynamo.ts`, alongside `listClaimsByParty` — query the claim partition directly (`PK = ORGCLAIM#<bn>`):
```ts
  async listClaimsByBN(bn: string) {
    const res = await ddbDoc.send(new QueryCommand({
      TableName: RAP_TABLE,
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: { ":pk": `ORGCLAIM#${bn}` },
    }));
    return ((res.Items ?? []) as Record<string, any>[]).map(itemToClaim).filter((c) => c.status === "granted");
  },
```
> `keys.claim(bn, partyId)` = `{ PK: ORGCLAIM#<bn>, SK: PARTY#<partyId> }` (`src/lib/dynamo/rap-table.ts:42`), so a PK query lists every party on the BN — no GSI needed.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx scripts/test-orgclaim-optin.ts`
Expected: PASS — all three ✅.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck` — no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/rap/types.ts src/lib/rap/repo.mock.ts src/lib/rap/repo.dynamo.ts scripts/test-orgclaim-optin.ts
git commit -m "feat(rap): OrgClaim.showcaseOptIn + listClaimsByBN (BN→claims query)"
```

---

## Task 2: Opt-in toggle action

**Files:**
- Modify: `src/lib/rap/actions-core.ts`, `src/lib/rap/actions.ts`
- Test: `scripts/test-showcase-optin-action.ts`

**Interfaces:**
- Consumes: `rapRepo.getClaim`, `rapRepo.putClaim` (Task 1 type).
- Produces: `setShowcaseOptInForParty(input: { partyId; bn; optIn: boolean; now: string }): Promise<{ ok: boolean }>` — only a party holding a **granted** claim on the BN may toggle it.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-showcase-optin-action.ts`:
```ts
import { setShowcaseOptInForParty } from "../src/lib/rap/actions-core";
import { rapRepo } from "../src/lib/rap";
import type { OrgClaim } from "../src/lib/rap/types";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean) => { console.log(`${ok ? "✅" : "❌"} ${n}`); ok ? pass++ : fail++; };
const claim = (o: Partial<OrgClaim>): OrgClaim => ({ businessNumber: "890561467", partyId: "c-acme", status: "granted", attestedAt: "2026-01-01T00:00:00.000Z", grantedBy: "system:bn-verify", ...o });

async function main() {
  await rapRepo.putClaim(claim({ partyId: "c-acme", businessNumber: "890561467" }));
  const ok = await setShowcaseOptInForParty({ partyId: "c-acme", bn: "890561467", optIn: true, now: "2026-07-15T00:00:00.000Z" });
  check("claim holder may opt in", ok.ok === true);
  check("flag + timestamp persisted", (await rapRepo.getClaim("890561467", "c-acme"))?.showcaseOptIn === true);

  const off = await setShowcaseOptInForParty({ partyId: "c-acme", bn: "890561467", optIn: false, now: "2026-07-15T00:00:00.000Z" });
  check("opt-out flips it off", off.ok === true && (await rapRepo.getClaim("890561467", "c-acme"))?.showcaseOptIn === false);

  const nope = await setShowcaseOptInForParty({ partyId: "c-nobody", bn: "890561467", optIn: true, now: "2026-07-15T00:00:00.000Z" });
  check("party without a granted claim is rejected", nope.ok === false);
  process.exit(fail ? 1 : 0);
}
main();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-showcase-optin-action.ts` — FAIL (`setShowcaseOptInForParty` undefined).

- [ ] **Step 3: Implement the core**

In `src/lib/rap/actions-core.ts`, add:
```ts
// Company toggles public-Index surfacing for a claimed org. Only a party holding
// a granted OrgClaim on the BN may change it (same gate as recordRapProgressForParty).
export async function setShowcaseOptInForParty(input: {
  partyId: string; bn: string; optIn: boolean; now: string;
}): Promise<{ ok: boolean }> {
  const claim = await rapRepo.getClaim(input.bn, input.partyId);
  if (!claim || claim.status !== "granted") return { ok: false };
  await rapRepo.putClaim({ ...claim, showcaseOptIn: input.optIn, showcaseOptInAt: input.now });
  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-showcase-optin-action.ts` — all four ✅.

- [ ] **Step 5: Wire the server action**

In `src/lib/rap/actions.ts` (session gate mirrors `claimOrgAction`):
```ts
export async function setShowcaseOptInAction(formData: FormData) {
  const session = getSession();
  if (!session || session.kind !== "company" || !session.partyId) return;
  return setShowcaseOptInForParty({
    partyId: session.partyId,
    bn: String(formData.get("bn") ?? ""),
    optIn: formData.get("optIn") === "on",
    now: new Date().toISOString(),
  });
}
```
Add `setShowcaseOptInForParty` to the existing import from `./actions-core`.

- [ ] **Step 6: Typecheck + build**

Run: `npm run typecheck && npm run build` — both pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/rap/actions-core.ts src/lib/rap/actions.ts scripts/test-showcase-optin-action.ts
git commit -m "feat(rap): per-org showcase opt-in toggle action (granted-claim gated)"
```

---

## Task 3: `/my-rap` opt-in toggle UI

**Files:**
- Modify: `src/app/my-rap/page.tsx`
- Test: build + manual drive (server-component UI)

**Interfaces:** Consumes `setShowcaseOptInAction` (Task 2), `rapRepo.listClaimsByParty` (existing).

- [ ] **Step 1: Read the current page**

Run: `sed -n '49,120p' src/app/my-rap/page.tsx` — note how it resolves the session, lists claims (`listClaimsByParty`), and renders per-claim sections. The toggle goes in each claim's section header.

- [ ] **Step 2: Add the toggle**

For each granted claim `c`, render a small `<form action={setShowcaseOptInAction}>` with a hidden `bn` = `c.businessNumber` and a checkbox `name="optIn"` `defaultChecked={c.showcaseOptIn === true}`, plus a submit button. Copy states plainly what it does and that it never changes the public score, e.g.:
> "Show my uploaded RAP on the public Index (as company-reported — it won't change my public score)."
Import `setShowcaseOptInAction` from `@/lib/rap/actions`. Wrap it in an inline `"use server"` shim only if a Server Component `<form action>` needs `void` return (mirror the `recordProgress` shim already in this file).

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build` — both pass.

- [ ] **Step 4: Drive it (best-effort; needs local DynamoDB + dev server)**

If Docker + dev server are available: sign in as a claimed company, toggle the switch on `/my-rap`, confirm the claim's `showcaseOptIn` persists (re-render keeps it checked). If not available, note it and describe the manual check; the action itself is covered by Task 2's test.

- [ ] **Step 5: Commit**

```bash
git add src/app/my-rap/page.tsx
git commit -m "feat(my-rap): per-org public-Index opt-in toggle"
```

---

## Task 4: RapData → commitments display-status map

**Files:**
- Create: `src/lib/index-evidence/status-map.ts`
- Test: `scripts/test-evidence-status-map.ts`

**Interfaces:**
- Consumes: `ProgressStatus` (`@/lib/rap/types`), `CommitmentStatus` (`@/lib/commitments/types`).
- Produces: `rapStatusToDisplay(s: ProgressStatus): CommitmentStatus`.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-evidence-status-map.ts`:
```ts
import { rapStatusToDisplay } from "../src/lib/index-evidence/status-map";
let pass = 0, fail = 0;
const check = (n: string, ok: boolean) => { console.log(`${ok ? "✅" : "❌"} ${n}`); ok ? pass++ : fail++; };
async function main() {
  check("met → reported (capped, never confirmed)", rapStatusToDisplay("met") === "reported");
  check("on_track → in_progress", rapStatusToDisplay("on_track") === "in_progress");
  check("delayed → stalled", rapStatusToDisplay("delayed") === "stalled");
  check("missed → stalled", rapStatusToDisplay("missed") === "stalled");
  check("not_started → committed", rapStatusToDisplay("not_started") === "committed");
  check("self-report never maps to confirmed", (["met","on_track","delayed","missed","not_started"] as const).every((s) => rapStatusToDisplay(s) !== "confirmed"));
  process.exit(fail ? 1 : 0);
}
main();
```

- [ ] **Step 2: Run to verify it fails** — `npx tsx scripts/test-evidence-status-map.ts` (module missing).

- [ ] **Step 3: Implement**

Create `src/lib/index-evidence/status-map.ts`:
```ts
// Map a self-reported RapData progress status onto the commitments display
// lifecycle. Self-report NEVER maps to "confirmed" — only the confirmation bridge
// (independent supplier attestation) can raise a commitment to confirmed. "met" is
// capped at "reported" (a self-report can't be more than reported).
import type { ProgressStatus } from "@/lib/rap/types";
import type { CommitmentStatus } from "@/lib/commitments/types";

export function rapStatusToDisplay(s: ProgressStatus): CommitmentStatus {
  switch (s) {
    case "met": return "reported";
    case "on_track": return "in_progress";
    case "delayed": return "stalled";
    case "missed": return "stalled";
    case "not_started": return "committed";
    default: return "committed";
  }
}
```

- [ ] **Step 4: Run to verify it passes** — all ✅.

- [ ] **Step 5: Commit**

```bash
git add src/lib/index-evidence/status-map.ts scripts/test-evidence-status-map.ts
git commit -m "feat(index-evidence): RapData→commitments display-status map"
```

---

## Task 5: The evidence resolver (pure)

**Files:**
- Create: `src/lib/index-evidence/resolver.ts`, `src/lib/index-evidence/index.ts`
- Test: `scripts/test-evidence-resolver.ts`

**Interfaces:**
- Consumes: `rapStatusToDisplay` (Task 4); `Commitment` (`@/lib/commitments/types`); `ProgressStatus` (`@/lib/rap/types`).
- Produces:
  - `type EvidenceTier = "confirmed" | "research" | "self_reported"`
  - `interface EvidenceRow { commitmentId: string; tier: EvidenceTier; displayStatus: CommitmentStatus; ranks: boolean; provenance: "research" | "company_uploaded"; confirmedAmount?: number }`
  - `interface EvidenceDeps { optedInBN(bn: string): Promise<boolean>; confirmedProcurement(bn: string): Promise<number>; projectedRows(bn: string): Promise<{ commitmentId: string; latestStatus: ProgressStatus }[]> }`
  - `resolveOrgEvidence(orgRows: Commitment[], deps: EvidenceDeps): Promise<EvidenceRow[]>`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-evidence-resolver.ts`:
```ts
import { resolveOrgEvidence, type EvidenceDeps } from "../src/lib/index-evidence";
import type { Commitment } from "../src/lib/commitments/types";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean) => { console.log(`${ok ? "✅" : "❌"} ${n}`); ok ? pass++ : fail++; };
const row = (id: string, o: Partial<Commitment> = {}): Commitment => ({
  id, orgName: "Acme", businessNumber: "890561467", sector: "mining", orgSize: "large",
  type: "procurement", title: id, targetYear: 2027, status: "reported", progressPct: 50,
  history: [{ period: "2026", status: "reported", progressPct: 50 }], createdAt: "2026-01-01T00:00:00.000Z", ...o,
});
const deps = (o: Partial<EvidenceDeps> = {}): EvidenceDeps => ({
  optedInBN: async () => false, confirmedProcurement: async () => 0, projectedRows: async () => [], ...o,
});

async function main() {
  // research baseline
  const base = await resolveOrgEvidence([row("c1")], deps());
  check("research tier, ranks, provenance", base.length === 1 && base[0].tier === "research" && base[0].ranks && base[0].provenance === "research");

  // confirmation bridge: procurement + confirmed spend → confirmed tier, carries $
  const conf = await resolveOrgEvidence([row("c1")], deps({ confirmedProcurement: async () => 3_000_000 }));
  check("procurement + confirmed spend → confirmed tier w/ amount", conf[0].tier === "confirmed" && conf[0].displayStatus === "confirmed" && conf[0].confirmedAmount === 3_000_000 && conf[0].ranks);

  // non-procurement never confirmed by the bridge
  const emp = await resolveOrgEvidence([row("c2", { type: "employment" })], deps({ confirmedProcurement: async () => 3_000_000 }));
  check("non-procurement stays research despite confirmed spend", emp[0].tier === "research");

  // opted-in projection → self-reported, non-ranking, badged
  const proj = await resolveOrgEvidence([row("c1")], deps({ optedInBN: async () => true, projectedRows: async () => [{ commitmentId: "rap-x", latestStatus: "on_track" }] }));
  const self = proj.find((r) => r.commitmentId === "rap-x")!;
  check("projected row is self_reported + non-ranking + company_uploaded", self.tier === "self_reported" && self.ranks === false && self.provenance === "company_uploaded");
  check("projected displayStatus mapped (on_track→in_progress)", self.displayStatus === "in_progress");
  check("opted-out org emits no projected rows", (await resolveOrgEvidence([row("c1")], deps({ optedInBN: async () => false, projectedRows: async () => [{ commitmentId: "rap-x", latestStatus: "on_track" }] }))).every((r) => r.tier !== "self_reported"));

  // no BN on the org → no confirmed, no projection
  const noBn = await resolveOrgEvidence([row("c1", { businessNumber: undefined })], deps({ confirmedProcurement: async () => 9, optedInBN: async () => true, projectedRows: async () => [{ commitmentId: "rap-x", latestStatus: "met" }] }));
  check("no BN ⇒ research-only, no bridge, no projection", noBn.length === 1 && noBn[0].tier === "research");
  process.exit(fail ? 1 : 0);
}
main();
```

- [ ] **Step 2: Run to verify it fails** — module missing.

- [ ] **Step 3: Implement the resolver**

Create `src/lib/index-evidence/resolver.ts`:
```ts
import type { Commitment, CommitmentStatus } from "@/lib/commitments/types";
import type { ProgressStatus } from "@/lib/rap/types";
import { rapStatusToDisplay } from "./status-map";

export type EvidenceTier = "confirmed" | "research" | "self_reported";

export interface EvidenceRow {
  commitmentId: string;
  tier: EvidenceTier;
  displayStatus: CommitmentStatus;
  ranks: boolean;                          // counts toward headline avgProgress + leaderboard
  provenance: "research" | "company_uploaded";
  confirmedAmount?: number;                // org confirmed procurement $ (confirmed tier only)
}

export interface EvidenceDeps {
  optedInBN(bn: string): Promise<boolean>;                                        // any granted claim on bn has showcaseOptIn
  confirmedProcurement(bn: string): Promise<number>;                             // Σ Coverage.byFlow.procurement.confirmed over parties claiming bn
  projectedRows(bn: string): Promise<{ commitmentId: string; latestStatus: ProgressStatus }[]>; // RapData commitments for org-bn-<bn>
}

// Resolve one org's commitments-domain rows into evidence rows, plus (when opted in)
// its projected self-reported RapData rows. Pure: all I/O is injected.
export async function resolveOrgEvidence(orgRows: Commitment[], deps: EvidenceDeps): Promise<EvidenceRow[]> {
  const bn = orgRows.find((r) => r.businessNumber)?.businessNumber;
  const confirmedSpend = bn ? await deps.confirmedProcurement(bn) : 0;

  const out: EvidenceRow[] = orgRows.map((r) => {
    const confirmed = r.type === "procurement" && confirmedSpend > 0;
    return {
      commitmentId: r.id,
      tier: confirmed ? "confirmed" : "research",
      displayStatus: confirmed ? ("confirmed" as CommitmentStatus) : r.status,
      ranks: true,
      provenance: "research",
      ...(confirmed ? { confirmedAmount: confirmedSpend } : {}),
    };
  });

  if (bn && (await deps.optedInBN(bn))) {
    for (const p of await deps.projectedRows(bn)) {
      out.push({
        commitmentId: p.commitmentId,
        tier: "self_reported",
        displayStatus: rapStatusToDisplay(p.latestStatus),
        ranks: false,
        provenance: "company_uploaded",
      });
    }
  }
  return out;
}
```

Create `src/lib/index-evidence/index.ts`:
```ts
export * from "./resolver";
export { rapStatusToDisplay } from "./status-map";
```

- [ ] **Step 4: Run to verify it passes** — all ✅.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck` — no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/index-evidence/resolver.ts src/lib/index-evidence/index.ts scripts/test-evidence-resolver.ts
git commit -m "feat(index-evidence): pure evidence resolver (confirmed>research>self-reported)"
```

---

## Task 6: Concrete `evidenceDeps` adapter (cross-domain readers)

**Files:**
- Create: `src/lib/index-evidence/readers.ts`
- Modify: `src/lib/index-evidence/index.ts` (export it)
- Test: `scripts/test-evidence-readers.ts`

**Interfaces:**
- Consumes: `rapRepo.listClaimsByBN` (Task 1), `rapRepo.listRapsByOrg`/`listCommitmentsByRap`/`getRollup` (existing), `repo.getCoverage` (`@/lib/repo`), `orgIdForBN` (`@/lib/rap/stage-extraction`).
- Produces: `evidenceDeps: EvidenceDeps` (the production wiring).

- [ ] **Step 1: Write the failing test (fakes injected, no DB)**

Create `scripts/test-evidence-readers.ts` — verify the *composition logic* with fake repos:
```ts
import { makeEvidenceDeps } from "../src/lib/index-evidence/readers";
let pass = 0, fail = 0;
const check = (n: string, ok: boolean) => { console.log(`${ok ? "✅" : "❌"} ${n}`); ok ? pass++ : fail++; };

async function main() {
  const deps = makeEvidenceDeps({
    listClaimsByBN: async (bn) => bn === "890561467"
      ? [{ businessNumber: bn, partyId: "c-a", status: "granted", attestedAt: "", grantedBy: "", showcaseOptIn: true },
         { businessNumber: bn, partyId: "c-b", status: "granted", attestedAt: "", grantedBy: "" }]
      : [],
    getCoverage: async (pid) => ({ companyId: pid, byFlow: { procurement: { reported: 0, confirmed: pid === "c-a" ? 1_000_000 : 500_000 }, capital: { reported: 0, confirmed: 0 } }, totalReported: 0, totalConfirmed: 0, confirmedPct: 0 }),
    listRapsByOrg: async () => [{ id: "rap-1" } as any],
    listCommitmentsByRap: async () => [{ id: "rc-1" } as any],
    getRollup: async () => ({ commitId: "rc-1", latestStatus: "on_track", percentComplete: 40 } as any),
  });

  check("optedInBN true when any granted claim opted in", (await deps.optedInBN("890561467")) === true);
  check("optedInBN false for unclaimed BN", (await deps.optedInBN("000000000")) === false);
  check("confirmedProcurement sums across parties on the BN", (await deps.confirmedProcurement("890561467")) === 1_500_000);
  const proj = await deps.projectedRows("890561467");
  check("projectedRows maps RapData commit → {commitmentId, latestStatus}", proj.length === 1 && proj[0].commitmentId === "rc-1" && proj[0].latestStatus === "on_track");
  process.exit(fail ? 1 : 0);
}
main();
```

- [ ] **Step 2: Run to verify it fails** — module missing.

- [ ] **Step 3: Implement the adapter**

Create `src/lib/index-evidence/readers.ts`:
```ts
// Concrete EvidenceDeps: fans out by BN across the RAP domain (claims + projection)
// and the economic-flow repo (Coverage). Deps point UP into this module; the
// commitments and RAP domains never import each other. `makeEvidenceDeps` takes the
// repo functions injected so it's unit-testable; `evidenceDeps` wires the real repos.
import { rapRepo } from "@/lib/rap";
import { orgIdForBN } from "@/lib/rap/stage-extraction";
import { repo } from "@/lib/repo";
import type { EvidenceDeps } from "./resolver";
import type { OrgClaim } from "@/lib/rap/types";
import type { Coverage } from "@/lib/repo/types";

export interface EvidenceRepos {
  listClaimsByBN(bn: string): Promise<OrgClaim[]>;
  getCoverage(companyId: string): Promise<Coverage>;
  listRapsByOrg(orgId: string): Promise<{ id: string }[]>;
  listCommitmentsByRap(rapId: string): Promise<{ id: string }[]>;
  getRollup(commitId: string): Promise<{ latestStatus: import("@/lib/rap/types").ProgressStatus } | null>;
}

export function makeEvidenceDeps(r: EvidenceRepos): EvidenceDeps {
  return {
    async optedInBN(bn) {
      return (await r.listClaimsByBN(bn)).some((c) => c.status === "granted" && c.showcaseOptIn === true);
    },
    async confirmedProcurement(bn) {
      const parties = await r.listClaimsByBN(bn);
      let sum = 0;
      for (const c of parties) sum += (await r.getCoverage(c.partyId)).byFlow.procurement.confirmed;
      return sum;
    },
    async projectedRows(bn) {
      const raps = await r.listRapsByOrg(orgIdForBN(bn));
      const rows: { commitmentId: string; latestStatus: import("@/lib/rap/types").ProgressStatus }[] = [];
      for (const rap of raps) {
        for (const c of await r.listCommitmentsByRap(rap.id)) {
          const roll = await r.getRollup(c.id);
          rows.push({ commitmentId: c.id, latestStatus: roll?.latestStatus ?? "not_started" });
        }
      }
      return rows;
    },
  };
}

export const evidenceDeps: EvidenceDeps = makeEvidenceDeps({
  listClaimsByBN: (bn) => rapRepo.listClaimsByBN(bn),
  getCoverage: (id) => repo.getCoverage(id),
  listRapsByOrg: (orgId) => rapRepo.listRapsByOrg(orgId),
  listCommitmentsByRap: (rapId) => rapRepo.listCommitmentsByRap(rapId),
  getRollup: (commitId) => rapRepo.getRollup(commitId),
});
```
In `src/lib/index-evidence/index.ts`, add: `export { evidenceDeps, makeEvidenceDeps } from "./readers";`

- [ ] **Step 4: Run to verify it passes** — all ✅.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck` — no errors. (Confirms the injected repo function signatures match the real `rapRepo`/`repo`.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/index-evidence/readers.ts src/lib/index-evidence/index.ts scripts/test-evidence-readers.ts
git commit -m "feat(index-evidence): cross-domain evidence readers (claims/coverage/projection)"
```

---

## Task 7: Redefine `confirmedPct` via the confirmed tier

**Files:**
- Modify: `src/lib/commitments/orgs.ts`
- Test: `scripts/test-org-confirmedpct.ts`

**Interfaces:**
- Consumes: `resolveOrgEvidence`, `evidenceDeps` (Tasks 5-6).
- Produces: `rollupOrgsWithEvidence(items, currentYear, deps?)` — async rollups whose `confirmedPct` = share of an org's **confirmable (procurement)** commitments whose tier resolves to `confirmed`. The existing sync `rollupOrgs` stays (used where evidence isn't wired), rendering `confirmedPct` as today for BN-less orgs.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-org-confirmedpct.ts`:
```ts
import { orgConfirmedPct } from "../src/lib/commitments/orgs";
import type { EvidenceRow } from "../src/lib/index-evidence";
let pass = 0, fail = 0;
const check = (n: string, ok: boolean) => { console.log(`${ok ? "✅" : "❌"} ${n}`); ok ? pass++ : fail++; };
const rows = (...t: [string, EvidenceRow["tier"], string][]): EvidenceRow[] =>
  t.map(([id, tier, type]) => ({ commitmentId: id, tier, displayStatus: "reported", ranks: tier !== "self_reported", provenance: "research", _type: type } as any));

async function main() {
  // confirmable denominator = procurement rows among ranking rows
  const procTypes = new Set(["p1", "p2"]);
  const evidence = rows(["p1", "confirmed", "procurement"], ["p2", "research", "procurement"], ["e1", "research", "employment"]);
  check("confirmedPct = confirmed / confirmable(procurement)", orgConfirmedPct(evidence, procTypes) === 50);
  check("no confirmable procurement ⇒ 0 (not NaN)", orgConfirmedPct(rows(["e1", "research", "employment"]), new Set()) === 0);
  check("self-reported rows never count", orgConfirmedPct(rows(["s1", "self_reported", "procurement"]), new Set()) === 0);
  process.exit(fail ? 1 : 0);
}
main();
```
> `orgConfirmedPct(evidence, confirmableIds)` is a pure helper: `confirmableIds` is the set of commitment ids that are procurement-type (the denominator); numerator = evidence rows in that set with `tier === "confirmed"`.

- [ ] **Step 2: Run to verify it fails** — `orgConfirmedPct` undefined.

- [ ] **Step 3: Implement the helper + async rollup**

In `src/lib/commitments/orgs.ts`, add:
```ts
import { resolveOrgEvidence, evidenceDeps, type EvidenceRow, type EvidenceDeps } from "@/lib/index-evidence";

// confirmedPct over the confirmable (procurement) commitments only — the honest
// denominator (§6). Numerator = those whose evidence tier resolved to "confirmed".
export function orgConfirmedPct(evidence: EvidenceRow[], confirmableIds: Set<string>): number {
  const denom = evidence.filter((e) => confirmableIds.has(e.commitmentId) && e.ranks).length;
  if (denom === 0) return 0;
  const num = evidence.filter((e) => confirmableIds.has(e.commitmentId) && e.tier === "confirmed").length;
  return Math.round((num / denom) * 100);
}
```
Then add an async `rollupOrgsWithEvidence(items, currentYear, deps: EvidenceDeps = evidenceDeps)` that groups by org (as `rollupOrgs` does), and for each org: `const ev = await resolveOrgEvidence(orgItems, deps)`, compute `confirmableIds = new Set(orgItems.filter(c => c.type === "procurement").map(c => c.id))`, set `confirmedPct = orgConfirmedPct(ev, confirmableIds)`. All other rollup fields (`avgProgress`, counts) are computed over `orgItems` exactly as today (research+confirmed rows ARE the commitments-domain rows; self-reported projected rows are not in `orgItems`, so they never affect these — satisfying "non-ranking" for free). Keep the existing sync `rollupOrgs` unchanged.

- [ ] **Step 4: Run to verify it passes** — all ✅.

- [ ] **Step 5: Typecheck** — `npm run typecheck` clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/commitments/orgs.ts scripts/test-org-confirmedpct.ts
git commit -m "feat(commitments): confirmedPct driven by confirmed-tier evidence (procurement denom)"
```

---

## Task 8: Surface on the Index + org scorecard

**Files:**
- Modify: `src/app/organizations/[id]/page.tsx` (org scorecard), `src/app/commitments/page.tsx` (Index), and their org rollup wiring
- Test: build + manual drive

**Interfaces:** Consumes `rollupOrgsWithEvidence` (Task 7), `resolveOrgEvidence` + `evidenceDeps` (Tasks 5-6).

- [ ] **Step 1: Read the surfaces**

Run: `sed -n '1,60p' src/app/organizations/[id]/page.tsx` and `sed -n '1,60p' src/app/commitments/page.tsx` — note where org rollups + commitment rows render.

- [ ] **Step 2: Drive the org rollups through evidence**

Where the Organizations leaderboard/scorecard calls `rollupOrgs`, switch to `await rollupOrgsWithEvidence(items, currentYear)` so `confirmedPct` reflects real confirmation. `avgProgress`/rank are unchanged (computed over the same commitments-domain rows).

- [ ] **Step 3: Render tier badges + the confirmed $**

On the org scorecard, for each commitment resolve its evidence row (via `resolveOrgEvidence(orgItems, evidenceDeps)` once per org) and render a provenance badge: `Research` · `Independently confirmed — $<amount> supplier-attested` (confirmed tier, using `confirmedAmount`). Then render the **self-reported** projected rows in a clearly separated, badged group titled "Company-reported — uploaded RAP, not independently verified" — these are the `tier === "self_reported"` rows; they must NOT appear in the headline number (they aren't in `orgItems`, so they're display-only by construction).

- [ ] **Step 4: Guard the hot path**

Only fetch projected rows for orgs that (a) have a `businessNumber` and (b) opted in — the resolver already short-circuits when `bn` is absent, and `optedInBN`/`projectedRows` are only awaited under those conditions. Confirm no extra RapData reads happen for BN-less orgs (the common case).

- [ ] **Step 5: Typecheck + build**

Run: `npm run typecheck && npm run build` — both pass.

- [ ] **Step 6: Drive it (best-effort)**

If Docker + dev server available: with a BN-mapped org that has an opted-in claim + an uploaded RAP, confirm its scorecard shows the badged self-reported rows (non-ranking) and, if it has confirmed procurement spend, a confirmed badge with the $ amount; confirm a BN-less org renders exactly as today. If not available, note it and describe the manual check.

- [ ] **Step 7: Commit**

```bash
git add src/app/organizations src/app/commitments
git commit -m "feat(index): surface confirmed-tier badge (+$) and opted-in self-reported rows"
```

---

## Task 9: Full-suite verification

**Files:** none.

- [ ] **Step 1: Run every evidence-precedence test**

```bash
for t in orgclaim-optin showcase-optin-action evidence-status-map evidence-resolver evidence-readers org-confirmedpct; do
  echo "== $t =="; npx tsx scripts/test-$t.ts || exit 1
done
```
Expected: all ✅.

- [ ] **Step 2: Typecheck + build + regression**

```bash
npm run typecheck && npm run build
```
Confirm `/commitments` and an org scorecard for a BN-less / non-opted-in org render identically to `main` (drive both if the app is runnable).

- [ ] **Step 3: Open the PR**

```bash
gh pr create --repo logisticPM/portal --base main \
  --title "feat(index): evidence-precedence — opt-in surfacing + confirmation bridge" \
  --body "Implements docs/superpowers/specs/2026-07-15-rap-index-evidence-precedence-design.md. Per-org showcase opt-in on OrgClaim; pure src/lib/index-evidence resolver (confirmed>research>self-reported); org-level procurement confirmation bridge via Coverage (carries the confirmed \$); confirmedPct now real; self-reported rows badged + non-ranking. Read-time projection, no cross-domain copy. Builds on the merged BN crosswalk."
```

---

## Notes

- **Confirmation bridge is org-level v1** (spec §6, §11.1): confirmed procurement spend for any party claiming the org's BN elevates its procurement commitments. Refinement to per-commitment $ attribution needs a `commitmentId` on `ReportedLine` — a later spec.
- **The demo econ-flow data** (Cedar Trust's June session, etc.) will make the confirmation bridge *visible* only once a demo company's BN is both claimed and mapped to a seeded org — not automatic, and only on opted-in orgs. Expect `confirmedPct` to stay 0 for most orgs until real supplier confirmations exist against a claimed BN.
