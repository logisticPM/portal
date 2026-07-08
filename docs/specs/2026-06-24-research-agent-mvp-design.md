# Research Agent — MVP design (B-plan)

> **Status:** draft for sign-off · 2026-06-24
> **Scope:** add a *second-layer aggregated-indicators* capability to the Indigenomics
> Data Portal — collect Indigenous-economy indicators from **public documents** (corporate
> ESG + **RAP** reports, federal open data, CER, ESTMA, NACCA), extract them, and feed the
> confirmed values into the Index. Source: `docs/Indigenomics_Data_Portal_Research_v1.xlsx`.
>
> **Governing principle (inherited from the portal):** *"Collecting data isn't the
> innovation; confirming it is."* Nothing an agent extracts is published. Extraction lands
> as `pending`; a human confirms it (reuse the `/verify` queue); only confirmed values feed
> the public Index. This is the same `report → confirm → coverage` spine, applied to research.

---

## 1. Decisions recapped (from the feasibility analysis)

1. **Feasible, high fit, medium effort.** "extract → confirm" maps 1:1 onto the existing
   "report → confirm" verification architecture and the "never auto-judge, route to human"
   philosophy. New domain `researchRepo`, third alongside `repo` / `surveyRepo`, same
   single-table shape.
2. **Do not lead with multi-agent.** Multi-agent orchestration is the T3 moat layer, not the
   MVP. MVP = `deterministic fetchers (machine-readable sources) + 1 LLM extraction agent
   (narrative sources) + human confirm gate`. Decompose into source-specialist agents in H2
   only if source heterogeneity demands it.
3. **Hybrid extraction is mandatory.** Dense numeric tables → deterministic table extraction;
   narrative / commitments → LLM with structured output. The 指标字典 is the taxonomy and the
   single biggest accuracy lever (taxonomy-grounded extraction ≫ raw-PDF extraction).
4. **RAP reports are a distinct source track**, not "more ESG PDFs." They carry
   commitments + targets + completion status (a temporal/longitudinal model) and the
   M-01 baseline-stratification signal. They also cross-check the existing RAP Impact Survey.
5. **Three non-negotiable guardrails:** provenance-or-reject · URL allowlist / SSRF
   containment · confidence-gate → human queue.

---

## 2. Source map → metric families → extraction mode

| Dictionary metrics | Source kind | Extraction mode |
|---|---|---|
| G-01 / G-02 / G-03 (federal 5%) | `federal_csv` (open.canada.ca) | **deterministic** (CSV → fields) |
| L-01 / L-02 (ESTMA payments) | `estma_db` (NRCan) | **deterministic** |
| E-04 (equity pipeline km) | `cer_snapshot` (CER) | **deterministic / semi** |
| F-01..04 (NACCA / IFI / AIOC / CILGC) | `nacca_report` | LLM extract (semi-structured) |
| P-01..04, E-01..03, C-01, M-02 | `esg_report` | LLM extract (narrative + tables) |
| **M-01, C-02, + commitment tracking** | **`rap_report`** | **LLM extract (narrative + commitments)** |

> Rule: machine-readable sources never go through an LLM. Only `esg_report`, `rap_report`,
> `nacca_report` get an extraction agent.

---

## 3. Type contract draft — `src/lib/research/types.ts`

> This is the **co-owned seam** (like `repo/types.ts`). Not yet committed as code — sign off
> first, then it becomes the shared interface. Mirrors existing conventions: ISO strings,
> denormalized `status`, soft-delete `withdrawn`, provenance.

```ts
// ===========================================================================
// RESEARCH / AGGREGATION DOMAIN — "second-layer" macro indicators sourced from
// PUBLIC documents. SEPARATE layer from the portal (src/lib/repo) and the RAP
// survey (src/lib/survey). Selected by REPO_IMPL: mock | dynamo.
//
// Core principle (mirrors the portal): nothing an agent extracts is published.
// Extraction lands 'pending'; a human confirms (reuse the verify queue); only
// confirmed values feed the public Index.
// ===========================================================================

// --- the metric dictionary (指标字典 v1.0) as code ------------------------
export type MetricFamily =
  | "procurement"      // P
  | "equity"           // E
  | "community"        // C
  | "gov_procurement"  // G
  | "financing"        // F
  | "estma"            // L
  | "meta";            // M

export type SourceKind =
  | "esg_report"    // corporate ESG / sustainability PDF   → LLM extract
  | "rap_report"    // Reconciliation Action Plan PDF        → LLM extract (narrative + commitments)
  | "federal_csv"   // open.canada.ca 5%-target dataset      → deterministic
  | "estma_db"      // NRCan ESTMA database                  → deterministic
  | "cer_snapshot"  // Canada Energy Regulator snapshot      → deterministic / semi
  | "nacca_report"; // NACCA / IFI annual report             → LLM extract

export type DataType =
  | "currency_cad" | "percent" | "integer" | "category" | "boolean" | "year" | "text";
export type Cadence = "annual" | "per_transaction" | "per_event";

export interface MetricDef {
  id: string;            // "P-01", "E-02", ... (dictionary key)
  family: MetricFamily;
  nameEn: string;
  nameZh: string;
  dataType: DataType;
  primarySource: SourceKind;
  cadence: Cadence;
  methodology: string;   // the dictionary's 方法论备注 — ALSO injected into the extraction prompt
}

// --- a fetched source artifact (the provenance root) ----------------------
export interface SourceDoc {
  id: string;
  kind: SourceKind;
  publisher: string;     // "Enbridge", "ISC", "NACCA", ...
  entityId?: string;     // the company/org/department it is about (null for whole-of-gov datasets)
  title: string;
  url: string;           // canonical public URL it was fetched from
  period: string;        // reporting year the doc covers, e.g. "2024"
  retrievedAt: string;   // ISO — when we fetched it
  sha256: string;        // content hash — dedupe + tamper-evidence
  s3Key: string;         // the raw artifact in the sources bucket
  pageCount?: number;
}

// --- where a value/commitment came from (anti-hallucination spine) --------
export interface Provenance {
  sourceDocId: string;
  page?: number;         // 1-based
  bbox?: [number, number, number, number]; // x0,y0,x1,y1 if layout-aware
  snippet: string;       // the EXACT source text the value was read from — REQUIRED
}

export type ExtractionStatus = "pending" | "confirmed" | "disputed" | "corrected" | "rejected";
export type Extractor = "deterministic" | string; // "deterministic" | a model id

// --- one extracted indicator value (the confirmable unit) -----------------
export interface ExtractedValue {
  id: string;
  metricId: string;      // → MetricDef.id
  entityId: string;      // company/org/department the value is about
  period: string;        // e.g. "2024"
  value: number | string | boolean | null; // null = "未披露" captured EXPLICITLY (a real signal)
  unit?: string;
  provenance: Provenance;            // no provenance ⇒ never persisted
  confidence: number;                // 0..1 from the extractor
  extractedBy: Extractor;
  extractedAt: string;               // ISO
  status: ExtractionStatus;          // denormalized; 'pending' until a human acts
  correctedValue?: number | string | boolean;
  conflictWith?: string[];           // ids of disagreeing values (cumulative vs annual, incl-US, …)
  reviewedBy?: string;
  reviewedAt?: string;
  withdrawn?: boolean;               // soft-delete; never hard-delete
}

// --- RAP commitment with a STATUS TIMELINE (the temporal sub-model) -------
export type CommitmentCategory =
  | "employment" | "procurement" | "community" | "cultural" | "governance" | "other";
export type CommitmentStatus =
  | "committed" | "in_progress" | "achieved" | "missed" | "dropped";

export interface CommitmentStatusPoint {
  period: string;        // the RAP edition/year this status was read from
  status: CommitmentStatus;
  provenance: Provenance;
}

export interface Commitment {
  id: string;
  entityId: string;      // the company
  category: CommitmentCategory;
  text: string;          // the commitment as written in the RAP
  target?: string;       // quantified target if any ("30% Indigenous procurement by 2025")
  firstSeenPeriod: string;             // RAP edition it first appeared in
  timeline: CommitmentStatusPoint[];   // status across successive RAP editions — the longitudinal view
  status: ExtractionStatus;            // confirm-gate status of the EXTRACTION itself
  withdrawn?: boolean;
}

// --- the seam -------------------------------------------------------------
export interface ResearchRepo {
  // metric dictionary
  listMetrics(): Promise<MetricDef[]>;
  getMetric(id: string): Promise<MetricDef | null>;

  // source artifacts
  putSourceDoc(doc: SourceDoc): Promise<SourceDoc>;
  getSourceDoc(id: string): Promise<SourceDoc | null>;
  findSourceByHash(sha256: string): Promise<SourceDoc | null>; // dedupe before re-fetch

  // extracted values — WRITE path is the agent/pipeline; always lands 'pending'
  putExtractedValue(v: ExtractedValue): Promise<ExtractedValue>;
  listValuesForEntity(entityId: string, period?: string): Promise<ExtractedValue[]>;
  listConfirmedByMetric(metricId: string, period: string): Promise<ExtractedValue[]>; // feeds the Index

  // RAP commitments
  putCommitment(c: Commitment): Promise<Commitment>;
  listCommitmentsForEntity(entityId: string): Promise<Commitment[]>;

  // the CONFIRM GATE — reuse the verify-queue UX
  listPendingExtractions(): Promise<ExtractedValue[]>;
  resolveExtraction(id: string, input: {
    status: "confirmed" | "disputed" | "corrected" | "rejected";
    correctedValue?: number | string | boolean;
    reviewedBy: string;
  }): Promise<ExtractedValue>;
}
```

### Single-table key design (new `ResearchData` table, same PK/SK + GSI1 + GSI2 shape)

| Entity | PK / SK | GSI1 (pending queue) | GSI2 (lookup) |
|---|---|---|---|
| MetricDef | `METRIC#<id>` / `DEF` | — | `FAMILY#<family>` / `METRIC#<id>` |
| SourceDoc | `SOURCE#<id>` / `DOC` | `ENTITY#<entityId>` / `SRC#<period>#<id>` | `HASH#<sha256>` / `SOURCE#<id>` |
| ExtractedValue | `ENTITY#<entityId>` / `VALUE#<metricId>#<period>#<id>` | `STATUS#<status>` / `VAL#<extractedAt>#<id>` | `METRIC#<metricId>#<period>` / `VAL#<id>` |
| Commitment | `ENTITY#<entityId>` / `COMMIT#<id>` | `STATUS#<status>` / `COMMIT#<id>` | — |

- GSI1 `STATUS#pending` = the human confirm queue (one query).
- GSI2 `METRIC#<id>#<period>` = confirmed-values-by-metric, feeds the Index.
- GSI2 `HASH#<sha256>` = dedupe — don't re-extract an unchanged doc.

---

## 4. AWS component architecture (vs the existing SST stack)

The portal is **SST v3 + OpenNext on AWS** (Next.js as Lambda behind CloudFront, DynamoDB
us-east-1). Long-running collection **must not** sit in the Next.js request lifecycle. Add a
worker plane, all SST-provisioned:

```
 EventBridge (annual/quarterly per metric cadence)
        │  also: manual "run now" from an Indigenomics-admin action
        ▼
 Step Functions  (orchestrator: per entity × per source, fan-out + collect)
        │
   ┌────┴───────────────┬───────────────────────────┐
   ▼                    ▼                            ▼
 Fetcher Lambda     Deterministic Lambda        Extraction Lambda
 download → S3      federal_csv / estma_db /     esg_report / rap_report /
 (sources bucket)   cer_snapshot → fields        nacca_report
 + sha256 + dedupe       │                        │ 1) parse (Textract / Docling)
        │                │                        │ 2) tables → deterministic extract
        │                │                        │ 3) narrative/commitments → Claude
        │                │                        │    (structured output, schema = MetricDef;
        │                │                        │     metric terms + methodology in prompt)
        │                │                        │ 4) bind Provenance (page/bbox/snippet)
        │                │                        │ 5) confidence + conflict detection
        └────────────────┴────────────┬───────────┘
                                       ▼
                        putExtractedValue / putCommitment
                        → DynamoDB ResearchData  (ALWAYS status='pending')
                                       ▼
                 /verify (extended): Indigenomics human confirm gate
                 confirm | dispute | correct | reject  → status flips
                                       ▼
                 listConfirmedByMetric → the public Index / analytics page
```

New SST resources: `ResearchData` (Dynamo), `Sources` (S3 bucket, raw PDFs/CSVs),
a Step Functions state machine + the three Lambdas, EventBridge rules. Claude via
**AI Gateway or direct** for the extraction Lambda. All IAM least-privilege via `link:[...]`.

---

## 5. Guardrails (the three non-negotiables, made concrete)

1. **Provenance-or-reject.** `putExtractedValue` rejects any value whose `provenance.snippet`
   is empty or whose snippet doesn't contain the asserted value (string/number check). No
   citation ⇒ not persisted. Doubles as auto-capture of the dictionary's 方法论备注.
2. **URL allowlist / SSRF.** Fetcher only downloads from a configured allowlist of publisher
   domains (suncor.com, enbridge.com, telus.com, open.canada.ca, nrcan.gc.ca, nacca.ca, …).
   No following arbitrary links found inside documents.
3. **Confidence gate.** `confidence < τ`, any `conflictWith`, or `value === null` ("未披露")
   → stays `pending`, surfaced to the human queue, never auto-confirmed. Untrusted PDF text
   is treated as data, never instructions (structured-output + must-cite-snippet also neuter
   prompt injection from a malicious/garbage report).

---

## 6. Try-run checklist — 3 real RAP reports

Goal: prove "fetch → parse → hybrid-extract → provenance → pending → confirm" end-to-end on a
small, hard corpus before building any orchestration. Gold values: cross-check against the
existing xlsx columns where present.

**Picks (chosen to stress different failure modes):**

| # | Company | RAP traits | Stresses |
|---|---|---|---|
| 1 | **Enbridge** | "22 commitments, 10 achieved" | **commitment status-timeline** extraction (the novel/hard part) |
| 2 | **TELUS** | tech sector, first RAP 2021 (multi-edition), PAIR Silver | **longitudinal** tracking across editions + non-resource RAP |
| 3 | **Agnico Eagle** | Inuit training $ tracked yearly ($0.3–4.6M, 2020–25) | **numeric extraction from narrative** (C-02) |

**Per report, extract & confirm:**
- M-01 RAP publication year (+ edition history) — with snippet.
- ≥ 5 commitments → `Commitment` rows with `category`, `target?`, and a `timeline` point per edition.
- C-02 Indigenous training/capacity $ where present — with page + snippet.
- Any P-/E-/C- value the RAP states (e.g. procurement target %).

**Acceptance criteria:**
- [ ] Every persisted value carries a non-empty `provenance.snippet` that contains the value.
- [ ] ≥ 80% field-level precision vs hand-checked gold on the numeric fields.
- [ ] Commitment status correctly read for Enbridge ("achieved" vs "in_progress" split).
- [ ] All low-confidence / conflicting / "未披露" items land in the pending queue, none auto-confirmed.
- [ ] Re-running on the same PDF (same sha256) does **not** re-extract (dedupe works).
- [ ] A deliberately garbage/injection-laced page produces no published value (guardrail #1/#3 hold).

---

## 7. Scope line

**In (MVP):** `researchRepo` + `ResearchData` table + `Sources` bucket; deterministic
fetchers for federal_csv/estma/cer; **one** extraction Lambda for esg/rap/nacca; Textract-first
parsing; the three guardrails; extend `/verify` with a "research values" tab; the 3-report try-run.

**Out (H2):** multi-agent decomposition into source-specialist agents; automated
grounding-eval regression set; cross-source reconciliation UI; public per-entity research
pages; scheduled full-corpus runs.

---

## 8. Open decisions (defaulted — flag to override)

1. **Parser for MVP:** default **AWS Textract** (already in stack, IAM-linked) + a Claude
   vision pass for narrative; benchmark Docling as the free alternative; escalate to Reducto
   only if $-table precision fails. → *default: Textract-first.*
2. **Confirm-gate location:** default **extend `/verify`** with tabs (certifications |
   research values), reusing the existing resolve-action pattern, rather than a new route.
3. **Research entity identity:** research entities (Suncor, ISC, NACCA) are **public companies/
   departments, not OCAP-protected suppliers** → default a **separate `entityId` namespace**,
   not the portal's `Party` registry.
4. **Commitment as its own entity** (not folded into `ExtractedValue`) — kept separate above
   because of the status-timeline. → *default: keep separate.*
