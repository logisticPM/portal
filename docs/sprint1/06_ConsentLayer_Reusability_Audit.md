# Consent-Layer Codebase — Reusability Audit (Member 3 deliverable, task T6)

**Repo:** `Indigenomics Tech Jam/consent-layer` · **Size:** ~9,200 LOC (TS/TSX/SQL); ~4,160 app + ~1,000 schema · **No tests, no LICENSE.**

## 1. Inventory
- **Stack:** Next.js `^14.2.32` (App Router), React 18, TypeScript 5 (strict). Supabase JS `^2.45` (+`ssr` installed but unused — plain `createClient` everywhere). Tailwind 3.4 (custom `signal`/`ink`/`paper` tokens). `@react-pdf/renderer` (client PDF), `qrcode.react`. **No auth lib, no test runner, no ORM.**
- **Pages:** `/`, `/setup` (wizard), `/card`, `/directory` + `/[id]`, `/inbox`, `/wall`, `/group` + `/[code]`, `/encounter/[id]`, `/witness/[code]`. **API:** `ai/reflect`, `participant/{create,consent,wipe}`, `request/reply`, `session/upgrade` (all node runtime).
- **DB:** 7 tables (`participants`, `connection_requests`, `routing_decisions`, `encounters`, `encounter_participants`, `encounter_witnesses`, `ai_use_receipts`); deterministic PL/pgSQL functions (`evaluate_routing` 5-branch gate, encounter/group/witness fns); `live_wall_counts` view; Realtime on all tables; RLS enabled but **permissive `using(true)`**.
- **LLM:** `src/lib/ai-gateway.ts` — OpenAI-compatible `POST /chat/completions` to the Indigenomics Gateway, default `telus-qwen`.

## 2. Reusable assets (rated A = Reconciliation Hub · B = extend consent app)

| Asset | A | B | Note |
|---|:--:|:--:|---|
| Next.js 14 + TS + Tailwind scaffold | **High** | **High** | Clean, current, no cruft |
| Supabase client bootstrap (anon + service-role) | **High** | **High** | Done correctly; portable |
| **LLM gateway client** (`ai-gateway.ts`) | **High** | **High** | Exact integration A needs for RAG; lift verbatim |
| **`ai_use_receipts` audit pattern** | **High** | **High** | Standout for A — `fields_accessed`/`fields_excluded`/`model_pinned`/zero-retention → rename to `sources_cited` and it *is* citation-first provenance |
| LLM route pattern (idempotent, receipt-then-write) | **High** | **High** | Good reference impl |
| PDF + JSON receipt builders (`kantara.ts`, receipt PDFs) | Med | **High** | Rendering machinery reusable; content throwaway |
| HMAC session token (`session-token.ts`) | Med | **High** | Lightweight identity primitive — *not* real auth |
| Realtime + polling fallback pattern | Low–Med | **High** | Clean copyable pattern |
| Deterministic-SQL-function technique | Low | **High** | Technique reusable; these fns encode consent rules |
| UI/design tokens | Med | **High** | `signal-*` is consent-semantic; `ink`/`paper` transfer; bespoke (no shadcn) |
| **OCAP / refusal-boundary governance** (RB1–RB4) | **High (framing)** | **High** | Transferable sovereignty/citation discipline — the DNA to carry over |

## 3. Throwaway for direction A (consent-domain-bound)
`attention_consent` model · Gate/Encounter routing (`evaluate_routing`, requests/decisions tables) · encounter & witness machinery · the Live Wall · interaction-mode vocabulary · directory/inbox/card + QR identity exchange. *(For direction B these are not throwaway — they are the product.)*

## 4. Tech debt / production gaps (all explicitly found)
- **No real auth** — identity = localStorage UUID + HMAC token; `TECH_CHOICES.md` flags as "Critical for production"; `@supabase/ssr` installed but unused.
- **Permissive RLS** — all 7 tables `using(true)`; only 3 writes gated via app-layer triggers, not RLS. Needs `auth.uid()` scoping.
- **Single hardcoded event** — `event_id:'impact-2026'` literal; no `events` table. First thing direction B must build.
- **No LICENSE** — reuse legally unspecified; `TECH_CHOICES.md` says reuse "must pass a fresh review against the parent spec." **Gating item.**
- **No tests**; thin LLM client (no streaming/retry/timeout); UTC-only; no observability; stray `console.log` in realtime handlers.
- Positives: strict TS on; fail-closed routing; snapshot-on-write integrity; no TODO/FIXME/HACK anywhere.

## 5. Effort & recommendation
- **A — Reconciliation Hub:** ~70% of app + ~90% of schema is throwaway. Do **not** fork — **start fresh and cherry-pick** `ai-gateway.ts`, the `ai_use_receipts` schema/route pattern, PDF/JSON receipt rendering, and design tokens. Saves ~1–2 weeks; the RAG core (ingestion, embeddings, vector store, retrieval, citation rendering) is **all new**. Head start: *conceptual + integration*, modest.
- **B — Extend consent app:** **Fork-and-extend.** ~60–70% of a v1 exists as coherent code. Named extensions map to known gaps: multi-event (moderate; literals mark the seams), **auth+RLS rewrite (biggest task, ~1–2 wks)**, organizer dashboard (moderate), data-consent surface (natural). Head start: *real codebase*, medium risk concentrated in auth/RLS + licensing.

## 6. Bottom line
**B gets a meaningful codebase head start; A gets a meaningful concept/integration head start but must be built fresh.** Either way, resolve the **missing LICENSE** and the **"fresh spec/Refusal-Boundary review before reuse"** clause first.
