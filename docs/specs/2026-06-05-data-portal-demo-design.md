# Indigenomics Data Portal — Demo Design Spec

**Status:** Approved direction · ready to build
**Date:** 2026-06-05
**Audience:** The capstone team — both the **Data Architecture group** and the **Questionnaire + Confirmation group**
**Purpose:** Single source of truth for the demo build. Read this before writing code. It tells you what we're building, how the two groups divide the work, and the exact interface where your two halves meet.

---

## 0. How to read this doc

- **Everyone:** read §1–§3 (context, scope, architecture) and §10–§11 (who owns what, how we coordinate).
- **Data Architecture group:** §4–§9 are your build surface, especially §6 (data model), §7 (the interface you implement), §8 (registry/identity), §9 (OCAP rules), and Appendix A (access patterns → DynamoDB keys).
- **Questionnaire + Confirmation group:** §5–§7 are yours, especially §7 (the interface you build against) and §2 (the three screens you own).

The one rule that makes parallel work possible: **the two groups touch only one shared file — `src/lib/repo/types.ts`.** Everything else, you own independently.

---

## 1. Product context (why this exists)

We are building the **Indigenomics Data Portal** — a consent-based, Indigenous-governed infrastructure for *verified* economic data. The full vision is in the pitch deck (`createrjam/consent-gatekeeper-mvp/rap_platform_mvp_design_10.html`). The one idea you must internalize:

> **Today, corporate Indigenous-economic data (e.g. "we spent $757M with Indigenous suppliers") is all self-reported and never confirmed by the other side.** Our product adds the missing layer: the **named Indigenous supplier confirms or disputes each entry.** Collecting data isn't the innovation — *confirming* it is.

The product is a **questionnaire + a confirmation layer**:

1. **Input — Collect:** a company answers a structured questionnaire on Indigenomics' RAP framework, itemized supplier-by-supplier.
2. **Confirm — the core:** each named Indigenous supplier confirms / disputes / corrects the entry.
3. **Output — Confirmed data:** a sovereign, confirmed dataset. Its first use is the **RAP Index** (a "reported vs confirmed" coverage view).

The demo proves layers 1→2→3 work end-to-end.

---

## 2. MVP scope — what we build for June 24

**The one-sentence demo:**
> Act as a company → answer the questionnaire (report itemized lines naming suppliers) → switch to a named supplier → confirm/dispute a line → see the coverage view update (reported vs confirmed).

**In scope (June 24):**
- Role switcher ("act as Company X" / "act as Supplier Y") — no real auth.
- Company questionnaire: submit itemized reported lines (supplier, amount, period) — **procurement** flow for the MVP (`equity` the high-value second). Australia collects only an aggregate total; we itemize by named supplier so each can confirm.
- Supplier view: list lines naming me that are pending, and confirm / dispute / correct each.
- Coverage view ("the Index", company side): reported vs confirmed, broken down by the 4 pillars.
- Supplier "My Record" view (supplier side): claims naming this supplier (any status) + their confirmed-revenue total + export/withdraw.
- Indigenomics RAP-analysis page (institute side): macro, cross-company rollup — total confirmed Indigenous economic activity, coverage %, by pillar, by identity tier. Read-only and **macro** (coverage, **not** a company league table). The Indigenomics role is a viewer, not a transacting party.
- Seeded **supplier registry** with identity tiers (company selects suppliers from it).
- All on **synthetic seed data**, running on **DynamoDB Local**, end-to-end.

**Out of scope (later / Aug 10 / future)** — see §13. Notably: real auth, supplier self-registration UI (seed instead), identity-verification integration, the financing/ledger ties, multi-company analytics, AWS deploy hardening. **No AI co-pilot** (deliberately dropped from the product).

**Definition of done (June 24):** a reviewer can run `npm run dev` against DynamoDB Local with seed data, perform the one-sentence demo above in the browser, and watch the coverage number change after a confirmation.

### Scope evolution [2026-06-10]

Three product decisions promoted here from the Sprint 2 design docs (these **supersede the matching June-24 bullets above**; the design detail lives in the attachments):

1. **Three persona portals + a demo "sign in as" landing** replace the single role-switcher page — *information architecture only; **real auth stays Horizon 2**.* → attachment [`sprint2/03_Portal_IA_and_Login_Routing.md`](../sprint2/03_Portal_IA_and_Login_Routing.md).
2. **Questionnaire expands to `procurement` + `equity`** as confirmable pillars (equity = the high-value second / phantom-JV fraud target). Adds a company-profile section + a read-only **"self-reported · unverified"** context block (employment, culture, governance). → attachment [`sprint2/02_Questionnaire_Expansion_Design.md`](../sprint2/02_Questionnaire_Expansion_Design.md). See §6.1.
3. **Supplier self-registration is built** (no longer a stretch — see §13).

**Ownership (reassigned 2026-06-10, see §10):** the **Data group** owns the Indigenomics portal **and** the AWS deploy; **Jack** = supplier portal; the **company owner** = report form + company sign-up.

---

## 3. Architecture & the one principle

Three layers, one product. The principle that governs the team split is **contract-first**:

```
        ┌─────────────────────────────────────────────┐
        │  UI  (Next.js pages)        [Q+C group]      │
        │  company · supplier · Indigenomics views     │
        └───────────────────┬─────────────────────────┘
                            │  imports & calls
                            ▼
        ┌─────────────────────────────────────────────┐
        │  THE SEAM:  src/lib/repo/types.ts            │
        │  PortalRepo interface  (BOTH groups co-own)  │
        └───────────────────┬─────────────────────────┘
              ┌─────────────┴──────────────┐
              ▼                             ▼
   repo.mock.ts (in-memory)      repo.dynamo.ts (DynamoDB)
   [Data group provides;          [Data group]
    Q+C group develops on it]      + dynamo/ + identity.ts + seed/
```

The UI never imports DynamoDB. The data layer never imports React. They meet at `PortalRepo`. The Q+C group develops against `repo.mock.ts` from day one; integration is flipping an env flag from `mock` to `dynamo`. Nobody is ever blocked waiting on the other group.

---

## 4. Tech stack & decisions

| Decision | Choice | Notes |
|---|---|---|
| Frontend | **Next.js (App Router) + TypeScript + Tailwind** | Same stack as the team's `consent-gatekeeper-mvp`; fork its design system & confirm/dispute UI patterns. |
| Database | **AWS DynamoDB, single-table design** | Access-pattern-driven (see Appendix A). |
| Data access | **`@aws-sdk/lib-dynamodb`** | Server-side only. |
| Local dev | **DynamoDB Local (Docker)** + seed script | Both groups run the full stack offline & reproducibly. |
| Auth | **Lightweight role-switcher** (synthetic) | "Act as Company/Supplier X." No Cognito for the MVP. |
| Hosting | **Vercel** (app) + DynamoDB in AWS via server-side IAM key | If the course mandates all-AWS, swap to Amplify/SST. |
| Secrets | `.env.local`, gitignored, **server-side only** | AWS keys **never** use a `NEXT_PUBLIC_` prefix. |

---

## 5. Repository structure

```
demo/
  docs/specs/2026-06-05-data-portal-demo-design.md   ← this file
  src/
    app/
      page.tsx            # landing + role switcher ("act as…")        [Q+C · shared]
      report/page.tsx     # COMPANY: questionnaire → submit lines       [Q+C · company — Nate]
      coverage/page.tsx   # COMPANY: reported-vs-confirmed view ("Index")[Q+C · company — Nate]
      confirm/page.tsx    # SUPPLIER: pending lines → confirm/dispute    [Q+C · supplier — Jack]
      record/page.tsx     # SUPPLIER: "My Record" — claims about me + $  [Q+C · supplier — Jack]
      analytics/page.tsx  # INDIGENOMICS: macro RAP analysis ("Index")   [Q+C · institute — Jack]
      components/         # shared UI, forked from gatekeeper            [Q+C · shared]
    lib/
      repo/
        types.ts          # ← THE SEAM: entities + PortalRepo interface  [BOTH co-own]
        repo.mock.ts      # in-memory impl (unblocks Q+C immediately)    [Data provides]
        repo.dynamo.ts    # real DynamoDB impl                           [Data]
        index.ts          # selects impl via REPO_IMPL env flag
      dynamo/
        client.ts         # DynamoDB document client (server-only)       [Data]
        single-table.ts   # PK/SK key helpers                            [Data]
      identity.ts         # identity tiers (nation/CCAB/self-declared)   [Data]
      seed/
        seed.ts           # load synthetic parties + lines               [Data]
        fixtures.ts       # the synthetic dataset                        [Data]
    .env.local            # AWS creds (gitignored, server-only)
```

---

## 6. Data model (4 entities)

These TypeScript types live in `src/lib/repo/types.ts`. They are the shared vocabulary for both groups.

```ts
// How strongly a supplier's Indigenous status is verified.
// 'self_declared' is the weakest tier — and the one fraud exploits, so it is shown explicitly.
export type IdentityTier = 'nation' | 'ccab' | 'self_declared';

export type PartyRole = 'company' | 'supplier';

export interface Party {
  id: string;
  role: PartyRole;
  name: string;
  identityTier?: IdentityTier;   // suppliers only
  registered: boolean;           // false = named by a company but not yet registered (future invite flow)
  createdAt: string;             // ISO 8601
}

// The 4 Indigenomics RAP pillars (confirmed on indigenomics.com — NOT Australia's
// Relationships/Respect/Opportunities/Governance). These ARE the economic flow categories:
// a line's pillar tells you what kind of flow it is, so no separate flowType is needed.
// MVP flagship: 'procurement'. High-value second: 'equity' (where JV / ownership fraud hides).
export type Pillar = 'equity' | 'capital' | 'procurement' | 'innovation';

export type ConfirmationStatus = 'pending' | 'confirmed' | 'disputed' | 'corrected';

// A single itemized claim reported by a company about a named supplier.
export interface ReportedLine {
  id: string;
  companyId: string;
  supplierId: string;
  amount: number;                // CAD
  pillar: Pillar;
  period: string;                // e.g. "2025" or "2025-Q1"
  reportedAt: string;            // ISO 8601
  status: ConfirmationStatus;    // denormalized for fast listing; 'pending' until the supplier acts
  withdrawn?: boolean;           // OCAP soft-delete marker (never hard-delete)
}

// The named supplier's response to a reported line.
export interface Confirmation {
  lineId: string;
  status: 'confirmed' | 'disputed' | 'corrected';
  correctedAmount?: number;      // set when status === 'corrected'
  byPartyId: string;             // the supplier
  respondedAt: string;           // ISO 8601
  withdrawn?: boolean;           // OCAP: supplier may withdraw their confirmation (line reverts to 'pending')
}

// Derived rollup — the "Index" view.
export interface Coverage {
  companyId: string;
  byPillar: Record<Pillar, { reported: number; confirmed: number }>;
  totalReported: number;
  totalConfirmed: number;
  confirmedPct: number;          // the headline "% of reported $ confirmed"
}
```

**Coverage counting rule** (so `repo.mock` and `repo.dynamo` agree exactly):
- `reported` = sum of **all** reported-line amounts for the pillar (what the company claimed), regardless of status.
- `confirmed` = `confirmed` lines at their reported amount **+** `corrected` lines at their **corrected** amount. `disputed`, `pending`, and `withdrawn` lines contribute **0**.
- `confirmedPct = totalConfirmed / totalReported`.

**Supplier-side mirror** — what a supplier sees *about themselves* (the OCAP Access/Ownership surface, and the seed of a portable verified-revenue record):

```ts
export interface SupplierRecord {
  supplierId: string;
  confirmedRevenue: number;   // confirmed + corrected amounts naming this supplier (same counting rule as Coverage.confirmed)
  pendingCount: number;
  disputedCount: number;
  lines: ReportedLine[];      // all lines naming this supplier, any status
}
```

**Macro / Indigenomics mirror** — the cross-company rollup that powers the institute's RAP-analysis page (the "Index" at economy level):

```ts
export interface IndexSummary {
  totalReported: number;
  totalConfirmed: number;
  confirmedPct: number;                                  // coverage across the whole dataset
  byPillar: Record<Pillar, { reported: number; confirmed: number }>;
  byTier: Record<IdentityTier, { confirmed: number }>;   // confirmed $ by supplier identity tier (integrity lens)
  companyCount: number;
  supplierCount: number;
  disputedCount: number;
}
```

### 6.1 The `report` questionnaire — procurement (MVP)

**Mechanics borrowed from Australia's 2025 RAP Impact Survey (Q30–33); taxonomy is Indigenomics'.** A company adds **one line per named supplier** — Australia collects only an aggregate total, so itemizing by named supplier (so each can confirm) is exactly our addition:

| Field | Source / note |
|---|---|
| Supplier | picker over the registry (`listParties('supplier')`), shows the **identity-tier badge** |
| Amount (CAD) | exact dollar value (Australia Q31 enters the full amount) |
| Period | reporting period, e.g. `2025` |
| Pillar | fixed to `procurement` for the MVP (`equity` is the high-value second) |

**The certified-vs-self distinction comes free.** Australia asks it as a separate question (Q31 total vs Q32 Supply-Nation-certified). Because every line carries its supplier's `identityTier`, `IndexSummary.byTier` computes "confirmed $ at CCAB-certified vs nation-verified vs self-declared" automatically — no extra question.

**Australia mechanics we reuse:** procurement amount buckets ($0–5k · 5k–100k · 100k–1m · 1m–5m · 5m–10m · >10m · >20m · >50m · >100m) for display ranges; certified-vs-self tiering; annual reporting cadence; and (future) the Action→Deliverable→Timeline→Responsibility commitment-table format from the McKinsey RAP.

**Expansion [2026-06-10] → see attachment [`sprint2/02_Questionnaire_Expansion_Design.md`](../sprint2/02_Questionnaire_Expansion_Design.md):** the report flow adds **equity** as a second confirmable pillar — same `ReportedLine` shape with `pillar: "equity"`, **no `types.ts` change**. The governing rule is **confirmability = a named Indigenous counterparty can verify it**: `procurement` + `equity` are confirmable (a supplier / JV partner confirms them); employment, culture and governance (AU Q14–29, 38–41) are company-level **context** — shown read-only and **never as "verified."** That attachment buckets all 41 AU questions and explains the pillar mismatch (AU's economic data is procurement+employment only; equity/capital/innovation are Indigenomics' distinctive lens).

---

## 7. The seam — `PortalRepo` (the interface both groups build on)

This is the most important section. The Data group **implements** it (twice: mock + DynamoDB). The Q+C group **calls** it and never looks inside.

```ts
export interface PortalRepo {
  // --- parties / registry ---
  getParty(id: string): Promise<Party | null>;
  listParties(role?: PartyRole): Promise<Party[]>;           // powers the role-switcher & supplier picker
  registerSupplier(input: {                                  // STRETCH (see §8) — not in the walking skeleton
    name: string;
    identityTier: IdentityTier;
  }): Promise<Party>;

  // --- company side ---
  createReportedLine(input: {
    companyId: string;
    supplierId: string;
    amount: number;
    pillar: Pillar;
    period: string;
  }): Promise<ReportedLine>;
  listLinesForCompany(companyId: string): Promise<ReportedLine[]>;

  // --- supplier side ---
  listPendingForSupplier(supplierId: string): Promise<ReportedLine[]>;   // the confirm inbox
  recordConfirmation(input: {
    lineId: string;
    status: 'confirmed' | 'disputed' | 'corrected';
    correctedAmount?: number;
    byPartyId: string;
  }): Promise<Confirmation>;
  getSupplierRecord(supplierId: string): Promise<SupplierRecord>;        // the "My Record" view

  // --- index / coverage ---
  getCoverage(companyId: string): Promise<Coverage>;       // per-company coverage (Nate's coverage view)
  getIndexSummary(): Promise<IndexSummary>;                // macro cross-company rollup (Indigenomics analytics view)

  // --- OCAP / data sovereignty (see §9) ---
  exportRecords(partyId: string): Promise<{
    party: Party;
    lines: ReportedLine[];
    confirmations: Confirmation[];
  }>;
  withdraw(partyId: string): Promise<void>;                  // soft-delete; supplier's confirmations revert lines to 'pending'
}
```

**Implementation selector** (`src/lib/repo/index.ts`):

```ts
import { mockRepo } from './repo.mock';
import { dynamoRepo } from './repo.dynamo';
export const repo: PortalRepo =
  process.env.REPO_IMPL === 'dynamo' ? dynamoRepo : mockRepo;
```

**Mock-first workflow:** the Data group writes `repo.mock.ts` (a simple in-memory/JSON implementation) **first and fast**, so the Q+C group can build all three screens immediately. Then the Data group builds `repo.dynamo.ts` behind the identical interface. Switching is one env var.

---

## 8. Supplier registry & identity tiers

**Why it exists:** so the company **selects** a supplier from a list (not free-typing a name), and so each supplier carries an **identity tier**. This is the home of the "identity layer" from the deck, and it mirrors Australia's proven model (**Supply Nation — Indigenous Business Direct**, a registry of certified Indigenous businesses buyers select from). It also narrows the **black-cladding / rent-a-feather** fraud hole: a tiered registry beats an unverified free-text name.

**Identity tiers** (`identity.ts`): `nation` (nation-verified) > `ccab` (CCAB-certified) > `self_declared` (weakest — shown explicitly so it's never mistaken for verified). The demo **stubs** how a tier is assigned; real verification (nations / CCAB integration) is future work.

**Demo behavior:**
- The registry is **seeded** with synthetic suppliers, each with a tier.
- The company questionnaire's supplier field is a **picker** over `listParties('supplier')`, showing each supplier's **tier badge** at selection. (Nice integrity beat: the reviewer sees tiers and, later, disputes/unconfirmed.)
- **Supplier self-registration UI is a STRETCH**, not in the core loop. Seed the registry instead. The `registerSupplier()` method exists in the interface so the data model supports it, but the form is built only if time allows.

**Keep the model open (do not build now, but don't preclude):** the real product needs a cold-start path — a company names a *not-yet-registered* supplier → a placeholder Party is created (`registered: false`) → that supplier is invited to register and confirm. For the demo we only select from the seeded registry, but `Party.registered` exists so this is addable later without a migration.

---

## 9. OCAP / data sovereignty — what it actually does here

**OCAP** (Ownership, Control, Access, Possession — First Nations data-sovereignty principles) is not a bolt-on compliance layer. In this Portal it governs specifically the **Indigenous supplier's data** (their confirmations + accruing record) — *not* the company's reported claims, which are corporate data. And three of its four principles are **the same machinery as the confirmation engine**, named from the sovereignty side:

| OCAP principle | What it *is* in this system |
|---|---|
| **Ownership** | The supplier's confirmation records are attributed to them and exportable — the basis for a future portable "verified revenue" record. |
| **Control** | confirm / dispute / correct / **withdraw**; silence ≠ consent. → This **is** the confirmation engine. |
| **Access** | `exportRecords(partyId)` — the supplier can see & download everything about them. |
| **Possession** | The dataset is **Indigenomics-governed**, not a third-party vendor's. (Why Indigenomics can credibly hold this data and a generic vendor can't.) |

**The withdrawal rule (define it this way in both `repo.mock` and `repo.dynamo`):**
> When a supplier withdraws, we **soft-delete their confirmation(s)** (`withdrawn: true`) and the affected `ReportedLine.status` **reverts to `'pending'`**. The company's reported claim **remains** (it is the company's data); it simply becomes *unconfirmed* again, and the coverage number drops.

This single rule is the demo's clearest "this is genuinely consent-based" moment, and it dictates a hard constraint for the Data group: **never hard-delete; always soft-delete.**

**CARE** is OCAP's "for whose benefit" companion: the data must benefit Indigenous suppliers (their record, discoverability) and the Indigenous economy (the Index) — not only corporate compliance. No code in the MVP, but it's the framing for every design choice.

---

## 10. Team responsibilities

| | **Data Architecture group** | **Questionnaire + Confirmation group** |
|---|---|---|
| **Owns** | DynamoDB single-table design; `repo.dynamo.ts`; `repo.mock.ts`; `dynamo/`; `identity.ts`; `seed/`; the withdrawal/soft-delete rule; coverage computation | `app/` pages: role-switcher, `report`, `confirm`, `index`; `components/` (forked from gatekeeper); the supplier picker + tier badges; the coverage UI |
| **Builds against** | the access-pattern list (Appendix A) | the `PortalRepo` interface, running on `repo.mock.ts` |
| **Definition of done** | `repo.dynamo.ts` passes the same calls the mock does, on DynamoDB Local, with seed data | the one-sentence demo (§2) works end-to-end on the mock |
| **Co-owns with the other group** | `src/lib/repo/types.ts` only | `src/lib/repo/types.ts` only |

### 10.1 Inside the Questionnaire + Confirmation group

The Q+C group splits by **which side of the exchange a surface serves** — mirroring the product's two halves (reporting vs confirming):

| Sub-role | Owns | Calls (via the `repo` seam) |
|---|---|---|
| **Company-facing — Nate** | `report/page.tsx` (questionnaire) + supplier picker + tier badges + company line list; `coverage/page.tsx` (per-company) | `createReportedLine`, `listLinesForCompany`, `listParties('supplier')`, `getCoverage` |
| **Supplier + institute — Jack** | `confirm/page.tsx` (confirm / dispute / correct), `record/page.tsx` — the **"My Record"** view, the **OCAP actions** (`withdraw` / `export`), supplier **registration** (stretch); `analytics/page.tsx` — the **Indigenomics macro RAP-analysis view** | `listPendingForSupplier`, `recordConfirmation`, `getSupplierRecord`, `withdraw`, `exportRecords`, `getIndexSummary`, `registerSupplier` (stretch) |
| **Shared (pair + sync)** | `page.tsx` role-switcher / landing, `components/` design system | — |

Both sub-roles call the **same `PortalRepo` seam**, so you're decoupled from each other exactly the way the whole Q+C group is decoupled from the Data group. The only intra-group shared surfaces are the role-switcher and `components/` — sync on those, nothing else.

> **Three views, one dataset — three audiences.** The same confirmed data, seen from three sides:
> - **Company** (`coverage`, Nate) — *"how much of what I reported is confirmed?"*
> - **Supplier** (`record`, Jack) — *"what's claimed about me, and what's my confirmed revenue?"* (OCAP Access/Ownership; seed of the portable verified-revenue ledger)
> - **Indigenomics** (`analytics`, Jack) — *"the macro RAP Index across the whole dataset"* (the institute's RAP analysis + the $100B instrument)
>
> Keep `analytics` **macro** — economy-level rollups, coverage %, pillar & identity-tier distributions — **not a ranked company league table** (grading companies is CCAB's lane). The **withdraw → number-drops** beat propagates to all three.
>
> **Split:** Nate owns the company side (2 screens); Jack owns the supplier side **and** the Indigenomics `analytics` view (3 screens). The cross-company aggregate itself (`getIndexSummary`) is **data-group work**; Jack renders it.
>
> **Reassignment [2026-06-10]:** the **Indigenomics `analytics` portal moved to the Data group** (who also own the AWS deploy) — it sits closest to the Index/data layer they already build. **Jack narrows to the supplier portal** (`confirm` / `record` / `register`). The company-side **report form + company sign-up** are the company owner's (Nate). The three-portal IA is in attachment [`sprint2/03`](../sprint2/03_Portal_IA_and_Login_Routing.md); the questionnaire expansion in [`sprint2/02`](../sprint2/02_Questionnaire_Expansion_Design.md).

### 10.2 Inside the Data Architecture group

Pure backend, so it splits by the natural backend seam — **writes/integrity vs reads/aggregates** — meeting at one internal contract.

**Internal seam (both co-design first):** `src/lib/dynamo/single-table.ts` — the PK/SK + GSI key design, driven by the access-pattern list (Appendix A). Sharon's reads dictate the GSIs; Sunny's writes populate the keys. Design it together, then split. (This is the data group's `types.ts`.)

| Sub-role | Owns | Implements (in `repo`) |
|---|---|---|
| **Storage / writes / integrity — Sunny** | `dynamo/client.ts`, **DynamoDB Local + seed loader** (`seed/seed.ts`), `identity.ts`, the soft-delete / status-machine rules | `createReportedLine`, `recordConfirmation`, `withdraw`, `registerSupplier` |
| **Reads / aggregates / dataset — Sharon** | the **GSIs** these reads need, the counting rules, `seed/fixtures.ts` (the realistic synthetic dataset) | `getParty`, `listParties`, `listLinesForCompany`, `listPendingForSupplier`, `exportRecords`, and the three rollups `getCoverage`, `getSupplierRecord`, `getIndexSummary` |

**Discipline:**
- Each person implements **their own methods in both `repo.mock.ts` and `repo.dynamo.ts`**. Split each impl into per-area files (e.g. `repo.dynamo/writes.ts` + `repo.dynamo/reads.ts`, assembled in an index) so the two never edit the same file.
- **Mock first:** in week 1 both prioritize their mock methods (this is what unblocks Nate & Jack), then build the DynamoDB impl.
- **Withdrawal is a shared rule:** the write side (Sunny) sets `withdrawn=true` and reverts the line to `pending`; the read side (Sharon) filters/reflects `withdrawn` everywhere. Align on it once — it lives in the co-owned integrity contract.

---

## 11. Coordination protocol

1. **Joint session #1 (both groups, first):** finalize Appendix A (access-pattern list) and write `src/lib/repo/types.ts` together. This is the contract. Commit it before splitting.
2. **Joint task #2 (the walking skeleton):** build the thinnest end-to-end thread — **one hardcoded company reports one line → one supplier confirms it → coverage shows 1/1** — through the real `PortalRepo` interface (mock impl is fine). Proves the seam works.
3. **Split & build in parallel** per §10. Data group ships `repo.mock.ts` first so Q+C is never blocked.
4. **Integration:** flip `REPO_IMPL=dynamo`. Because the interface is identical, this is wiring, not a rewrite.
5. **Sync rule:** any change to `types.ts` is announced to both groups (it's the only shared surface). Changes to anything else need no sync.

---

## 12. Milestones

- **Joint session #1 + walking skeleton:** week 1.
- **June 24 — MVP demo:** the one-sentence demo (§2) end-to-end on DynamoDB Local with seed data. Definition of done in §2.
- **August 10 — final:** hardening, the OCAP withdraw→coverage-drop beat polished, supplier self-registration (if pursued), methodology v0.1 + handover, honest go/no-go.

---

## 13. Out of scope (now) / future

- ~~**Supplier self-registration UI** — stretch~~ → **built [2026-06-10]** (`register/page.tsx`); registry still seeded too.
- **Real authentication** (Cognito or otherwise) — the demo now uses a three-portal **mock-login landing** (IA only, `sprint2/03`); **Cognito stays Horizon 2**.
- **Identity-verification integration** (nations / CCAB) — tiers are stubbed.
- **Cold-start invite flow** (company names an unregistered supplier → invite) — model supports it (`registered` flag); not built.
- **Financing / portable-ledger ties** (NACCA / IFI) — design rationale only; not built.
- **Multi-company analytics / the published Index** — coverage view only.
- **AWS deploy hardening, CI/CD** — local-first for the MVP.
- **AI co-pilot** — deliberately dropped from the product.

---

## 14. Decisions log & open questions

**Decided:**
- Database = **DynamoDB** (single-table). [2026-06-05]
- `repo` lives **inside Next.js** (one repo), not a separate AWS backend. [2026-06-05]
- Supplier registry: **seed for the demo**; self-registration form is a stretch. [2026-06-05]
- OCAP withdrawal: **soft-delete; line reverts to `pending`; company claim remains.** [2026-06-05]
- **Pillars = Indigenomics' economic pillars** (equity/capital/procurement/innovation), confirmed on indigenomics.com — *not* Australia's Relationships/Respect/Opportunities/Governance. [2026-06-05]
- **"Australia for mechanics, Indigenomics for taxonomy"** — borrow Australia's Impact-Survey field design (procurement buckets, certified-vs-self tier, annual cadence); keep Indigenomics' pillars. [2026-06-05]
- **MVP flagship flow = procurement**; **equity** is the high-value second (JV / ownership fraud). No separate `flowType` — `pillar` is the flow category. [2026-06-05]
- Canada adaptation later: Supply Nation → CCAB + nation verification; align to the emerging UBCIC–RRII 2026 RAP standard. [2026-06-05]
- No AI co-pilot. [earlier]
- **Three persona portals** (company / supplier / Indigenomics) + a **demo mock-login landing**; IA only — **real auth stays H2.** [2026-06-10]
- **Questionnaire: `procurement` + `equity` confirmable**; company profile + a read-only "self-reported · unverified" context block; **confirmability = a named Indigenous counterparty can verify it.** [2026-06-10]
- **Supplier self-registration: built** (was a stretch). [2026-06-10]
- **Ownership reassignment:** Data group owns the **Indigenomics portal + AWS deploy**; Jack = supplier portal; company owner = report form + company sign-up. [2026-06-10]

**Open (resolve in joint session #1):**
- Final field list for the questionnaire (which pillars/metrics beyond procurement get demo coverage?).
- Exact synthetic dataset shape (how many companies/suppliers/lines for a convincing coverage view?).
- DynamoDB single-table key design finalized from Appendix A (Data group).

---

## 15. Whole-product gaps & Horizon 2 (known, deferred)

**None of this is built for the June 24 demo.** It's recorded so the team builds forward-compatibly and so Indigenomics sees we understand the product beyond the demo. Ranked by importance to the *product* (not the demo).

| # | Gap | Why it matters | When |
|---|---|---|---|
| 1 | **Identity verification (real)** | The whole trust chain rests on "is this supplier genuinely Indigenous?" Today tiers are stubbed — a fake supplier can still confirm (the rent-a-feather hole). Needs CCAB API / nation endorsement / human review queue, not just an enum. | H2 — deepest gap |
| 2 | **Commitments layer** | We do `reported → confirmed`; the full RAP is `committed → reported → confirmed` (answers "did they hit their target?"). **Lane division when built: Indigenomics' framework + advisory _authors_ commitments; the Portal _consumes_ them as targets to score committed-vs-confirmed — it does not author them** (authoring would slide back into the dropped advisory / Co-pilot lane). The demo starts at `reported`, assuming commitments already exist. | H2 |
| 3 | **Dispute resolution workflow** | `dispute` is currently a terminal state. UBCIC's 2026 standard explicitly names dispute resolution. Needs notify-buyer → correct/evidence → transparent status or escalation. | H2 |
| 4 | **Reach engine** (notify / invite / auth) | A supplier can only confirm if the system reaches them and proves it's really them. The demo uses the role-switcher; production needs email/SMS invites + reminders + real auth. | H2 |
| 5 | **Buyer value loop** | Supplier incentive is solved (My Record). Companies need a positive reason too — a usable "verified" report / ESG export — beyond external compliance pressure. | H2 |
| 6 | **Indigenomics admin / curation** | Who configures the framework & questionnaire, publishes the Index, manages the registry, adjudicates disputes? `analytics` is read-only today. | H2 |
| 7 | **Privacy / visibility model** | Per-supplier $ is commercially sensitive. Define what the Index publishes vs keeps private (carry over Consent Layers' "counts only" wall). | H2 |
| 8 | **Data lifecycle** | Annual re-confirmation, year-over-year snapshots, amendments. | H2 / H3 |

**Forward-compatibility — do these in the demo build so H2 isn't blocked:** keep `dispute` a **non-terminal** status (a disputed line can later gain a resolution); **never hard-delete** (already required); keep `identityTier` on every supplier; and don't assume a `ReportedLine` is top-level forever (a future `Commitment` may become its parent).

### AI in the product — engine, not storefront

The advisory **"RAP Co-pilot" (AI that drafts RAPs) stays dropped** — it's a commodity (ESG copilots / ChatGPT), it competes with Indigenomics' own AI **and** their advisory business, and it raises the data-sovereignty/values flag. AI's real home is **inside the verification engine, as Horizon-2 back-office agents**, all running on Indigenomics' sovereign infrastructure:

- **Ingestion agent** — parse a company's procurement export into itemized, supplier-matched lines (cuts buyer friction → gap 5).
- **Entity-resolution agent** — match reported names to the registry; flag unregistered / duplicates.
- **Integrity / anomaly agent** — flag fraud-pattern signals (large self-declared amounts, phantom-JV clustering) on the confirmed dataset; feeds `analytics`. On-thesis for the fraud problem; **assists** identity verification (gap 1) but does **not** replace it.

> **Rule of thumb: AI belongs in the engine, not the storefront.** None of these agents are in the demo — the demo is the human `report → confirm` loop on synthetic data.

---

## Appendix A — Access patterns → DynamoDB sketch

The access-pattern list **is** the contract. Co-author it in joint session #1; it drives both `types.ts` and the DynamoDB key design.

| # | Access pattern | Interface method | DynamoDB sketch (Data group finalizes) |
|---|---|---|---|
| AP1 | Create a reported line | `createReportedLine` | `PutItem` line item |
| AP2 | List a company's lines (+status) | `listLinesForCompany` | `Query PK=COMPANY#<id>, SK begins_with LINE#` |
| AP3 | List lines pending a supplier's confirmation | `listPendingForSupplier` | GSI1: `GSI1PK=SUPPLIER#<id>, GSI1SK begins_with STATUS#pending#` |
| AP4 | Record a confirmation/dispute | `recordConfirmation` | `UpdateItem` on the line (status) + write Confirmation |
| AP5 | Coverage for a company | `getCoverage` | `Query` company lines, aggregate by status × pillar in the repo |
| AP5b | A supplier's own record (all lines naming me + confirmed total) | `getSupplierRecord` | GSI1: `Query GSI1PK=SUPPLIER#<id>` (all statuses), aggregate in the repo |
| AP5c | Macro cross-company rollup (the Index) | `getIndexSummary` | `Scan` + aggregate — synthetic scale only; precompute / materialize for real data |
| AP6 | Get a party (profile + tier) | `getParty` | `GetItem PK=PARTY#<id>, SK=PROFILE` |
| AP7 | List parties by role (picker / role-switch) | `listParties` | GSI2: `GSI2PK=ROLE#<role>` |
| AP8 | Withdraw (OCAP soft-delete) | `withdraw` | `UpdateItem` set `withdrawn=true`, revert affected lines to `pending` — **never delete** |
| AP9 | Export a party's records (OCAP) | `exportRecords` | `Query` the party's items, return as a bundle |
| AP10 | Register a supplier (STRETCH) | `registerSupplier` | `PutItem` party with `registered=true` |

> **Note on DynamoDB & aggregation:** DynamoDB is strong for the keyed reads/writes above but weak at ad-hoc aggregation. For the demo's synthetic scale, compute `getCoverage` (AP5) in the repo after a small query — do **not** over-engineer it.
