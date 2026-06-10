# 03 · Portal IA & Login Routing — three persona portals (design / hand-off)

**Sprint:** 2 · **Type:** Information-architecture proposal + hand-off · **Status:** Design agreed; **route restructure needs team sign-off** (it moves every group's pages — see §5).

> **Why:** Today the demo is one flat page (`/`) that lists every company, supplier, and the Index — a dev role-switcher. Proposal: split into **three persona portals**, entered from a demo **"sign in as…" landing**. This doc is the shared contract so each owner builds their portal consistently. **Jack builds the supplier portal only; the Data group builds the Indigenomics portal (they also own the AWS deploy); the landing + company portal are for others** (reassigned 2026-06-10 — see `01_Sprint2_Backlog_board` notes).

---

## 1. The one distinction that keeps this in scope

"Login → route to different interfaces" bundles two very different things:

| | What | Cost | Spec |
|---|---|---|---|
| **(A) Information architecture** | three portal shells, each its own nav + scoped pages | **low — do now** | new improvement |
| **(B) Real authentication** | passwords / Cognito / identity verification | **high** | §13 → **Horizon 2** |

**Decision (2026-06-10): do (A); keep (B) as a demo "sign in as" picker.** No Cognito. The landing is labelled **"demo · no real auth."** This matches the spec (real auth = H2, role-switcher = demo) while fixing the IA.

## 2. The three portals

| Portal | Persona | Pages | Owner |
|---|---|---|---|
| **Company** | the buyer being measured | `report` (the questionnaire), `coverage`, company self-registration | **Nate** |
| **Supplier** | the Indigenous business | `confirm` (inbox), `record` (My Record + OCAP export/withdraw), `register` | **Jack** |
| **Indigenomics** | the institute | `analytics` (the Index / RAP analysis) | **Data group** |

## 3. Route structure (Next.js App Router — route groups)

Route groups `(name)` give each portal its **own `layout.tsx`** (own nav, own accent) **without changing URLs**:

```
app/
  page.tsx                  ← the "sign in as…" landing (SHARED — co-own)
  (company)/
    layout.tsx              ← company nav (Nate)
    report/page.tsx   coverage/page.tsx   company-register/page.tsx
  (supplier)/
    layout.tsx              ← supplier nav (Jack)
    confirm/page.tsx   record/page.tsx   register/page.tsx
  (indigenomics)/
    layout.tsx              ← institute nav (Data group)
    analytics/page.tsx
```

`/confirm`, `/report`, `/analytics` etc. keep working — route groups don't appear in the URL.

## 4. The mock-login contract (no real auth)

- **Landing (`/`):** three doors — "I'm a company" · "I'm an Indigenous supplier" · "I'm Indigenomics." Header keeps the **"demo · synthetic data"** tag.
- Because there's no auth, *within* the Company and Supplier portals the existing **`?as=<id>` switcher** stays (you still pick *which* of the seeded companies/suppliers you are). The landing chooses the **portal**; `?as=` chooses the **entity**.
- Indigenomics portal needs no `?as=` (single institute view).
- A small dev "switch portal" link in each portal header is fine for demoing.

## 5. Migration note — why this needs sign-off (not a unilateral change)

Introducing the route groups **moves `report/` and `coverage/` (Nate's) and the landing (shared)**, not just Jack's pages. So:
- **Jack** stands up `(supplier)/` with its layout around his own pages (confirm / record / register).
- **Data group** stands up `(indigenomics)/` (the institute nav + `analytics`), alongside their AWS deploy.
- **Nate** moves `report/` + `coverage/` into `(company)/` and adds the company nav.
- The **landing** rewrite (door picker) is **co-owned** — agree on it in standup before someone replaces the current `/`.
- This is exactly the §11 coordination case: a shared-surface change announced to everyone first.

## 6. Acceptance (demo)
- From `/` a viewer picks a door and lands in a portal that shows **only that persona's pages** with its own nav.
- The trust loop still runs end-to-end across portals: Company `report` → Supplier `confirm` → Indigenomics `analytics`.
- Header still reads "demo · synthetic data"; the landing reads "no real auth."

**Refs:** spec `§10` (team split), `§11` (coordination), `§13` (auth = H2); this sprint `00_Sprint2_Plan` (RAP-31 frontend).
