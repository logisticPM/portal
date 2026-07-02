// RAP commitments seeded from Canadian companies' OWN PUBLIC disclosures
// (reconciliation / ESG / sustainability reports). Each carries a `source`.
//
// Data-integrity rules for this seed:
//  • These are the companies' *public commitments* — NOT sensitive Indigenous
//    data (which stays with communities / the client). See data-sovereignty note.
//  • Status never exceeds `reported` (self-reported). Nothing is `confirmed`,
//    because supplier/Nation confirmation is exactly the layer the portal adds
//    and that we do not have for scraped public data.
//  • rapType (Australian RAP tiers) is omitted — these are Canadian orgs
//    (CCAB/CCIB PAIR, TRC Call to Action #92), a different maturity framework.
//  • Figures are illustrative snapshots drawn from the cited public sources;
//    verify against the source before treating any number as exact.
import type {
  Commitment,
  CommitmentType,
  OrgSize,
  ProgressPoint,
  RapType,
  Sector,
} from "./types";

const T = "2025-01-15T00:00:00.000Z";

// Build a Commitment with an explicit, fixed field order. The DynamoDB
// round-trip (itemToCommitment) reconstructs in this SAME order, so the
// dynamo ≡ mock JSON equality in verify.ts holds. current status/% = last point.
function mk(p: {
  id: string;
  orgName: string;
  orgId?: string;
  sector: Sector;
  orgSize: OrgSize;
  type: CommitmentType;
  title: string;
  targetYear: number;
  rapType?: RapType;
  history: ProgressPoint[];
  source?: { label: string; url: string };
  detail?: string;
  targetText?: string;
}): Commitment {
  const last = p.history[p.history.length - 1];
  return {
    id: p.id,
    orgName: p.orgName,
    ...(p.orgId !== undefined ? { orgId: p.orgId } : {}),
    sector: p.sector,
    orgSize: p.orgSize,
    type: p.type,
    title: p.title,
    targetYear: p.targetYear,
    ...(p.rapType !== undefined ? { rapType: p.rapType } : {}),
    status: last.status,
    progressPct: last.progressPct,
    history: p.history,
    createdAt: T,
    ...(p.source !== undefined ? { source: p.source } : {}),
    ...(p.detail !== undefined ? { detail: p.detail } : {}),
    ...(p.targetText !== undefined ? { targetText: p.targetText } : {}),
  };
}

const h = (period: string, status: ProgressPoint["status"], progressPct: number): ProgressPoint => ({
  period,
  status,
  progressPct,
});

// Sources (companies' own public reconciliation / ESG pages).
const SRC = {
  rbc: { label: "RBC Reconciliation Action Plan 2025–2027", url: "https://www.rbc.com/indigenous/reconciliation-action-plan.html" },
  bmo: { label: "BMO Indigenous Commitments", url: "https://www.bmo.com/en-ca/main/about-bmo/our-impact/communities/indigenous-commitments/" },
  scotia: { label: "Scotiabank Truth & Reconciliation Action Plan", url: "https://www.scotiabank.com/ca/en/about/responsibility-impact/truth-reconciliation.html" },
  td: { label: "TD and Indigenous Peoples", url: "https://www.td.com/ca/en/about-td/diversity-and-inclusion/indigenous-peoples" },
  cenovus: { label: "Cenovus Indigenous Reconciliation", url: "https://www.cenovus.com/Sustainability/Social/Indigenous-reconciliation" },
  suncor: { label: "Suncor — Journey of Reconciliation", url: "https://sustainability.suncor.com/en/communities/partnering-with-indigenous-businesses-and-communities" },
  hydroone: { label: "Hydro One Indigenous Procurement", url: "https://www.hydroone.com/about/suppliers/indigenous-procurement" },
  teck: { label: "Teck 2024 Sustainability Report", url: "https://www.teck.com/media/2024-Sustainability-Report.pdf" },
  vale: { label: "Vale (NL) — NRCan profile", url: "https://natural-resources.canada.ca/maps-tools-publications/publications/vale-inco-newfoundland-labrador" },
  cn: { label: "CN Indigenous Reconciliation Report 2025", url: "https://www.railway.supply/cn-releases-first-indigenous-reconciliation-report/" },
} as const;

export const commitmentFixtures: Commitment[] = [
  // ── Finance ──────────────────────────────────────────────────────────────
  mk({
    id: "cm-rbc-proc",
    orgName: "RBC (Royal Bank of Canada)",
    sector: "finance",
    orgSize: "enterprise",
    type: "procurement",
    title: "RAP 2025–2027: grow Indigenous procurement across five ambition areas",
    detail: "Under RBC's 2025 to 2027 Reconciliation Action Plan, grow procurement with Indigenous-owned suppliers across its five ambition areas.",
    targetText: "higher Indigenous supplier spend by 2027",
    targetYear: 2027,
    history: [h("2025", "committed", 15), h("2026", "in_progress", 35)],
    source: SRC.rbc,
  }),
  mk({
    id: "cm-rbc-emp",
    orgName: "RBC (Royal Bank of Canada)",
    sector: "finance",
    orgSize: "enterprise",
    type: "employment",
    title: "RAP 2025–2027: expand Indigenous recruitment & retention",
    detail: "Expand Indigenous recruitment, development and retention programs under the same Reconciliation Action Plan.",
    targetText: "grow Indigenous workforce representation",
    targetYear: 2027,
    history: [h("2025", "committed", 10), h("2026", "in_progress", 28)],
    source: SRC.rbc,
  }),
  mk({
    id: "cm-bmo-proc",
    orgName: "BMO (Bank of Montreal)",
    sector: "finance",
    orgSize: "enterprise",
    type: "procurement",
    title: "Spend $10M annually with Indigenous suppliers (exceeded, $125M cumulative)",
    detail: "An annual Indigenous procurement target BMO reports having exceeded, reaching roughly $125M cumulative spend.",
    targetText: "$10M per year (exceeded)",
    targetYear: 2023,
    history: [h("2021", "in_progress", 55), h("2022", "reported", 90), h("2023", "reported", 100)],
    source: SRC.bmo,
  }),
  mk({
    id: "cm-bmo-gov",
    orgName: "BMO (Bank of Montreal)",
    sector: "finance",
    orgSize: "enterprise",
    type: "governance",
    title: "Maintain Gold-level PAIR (CCIB) certification & Office of Reconciliation",
    detail: "Sustain CCIB Gold-level Partnership Accreditation in Indigenous Relations and run a dedicated Office of Reconciliation.",
    targetText: "Gold PAIR maintained",
    targetYear: 2025,
    history: [h("2023", "in_progress", 60), h("2025", "reported", 100)],
    source: SRC.bmo,
  }),
  mk({
    id: "cm-scotiabank-proc",
    orgName: "Scotiabank",
    sector: "finance",
    orgSize: "enterprise",
    type: "procurement",
    title: "Truth & Reconciliation Action Plan: increase Indigenous supplier procurement",
    detail: "Part of Scotiabank's Truth and Reconciliation Action Plan (37 commitments): grow spend with Indigenous suppliers.",
    targetText: "increase Indigenous procurement",
    targetYear: 2025,
    history: [h("2023", "committed", 20), h("2024", "in_progress", 45), h("2025", "in_progress", 62)],
    source: SRC.scotia,
  }),
  mk({
    id: "cm-td-rel",
    orgName: "TD Bank Group",
    sector: "finance",
    orgSize: "enterprise",
    type: "relationships",
    title: "Invest $25M+ in Indigenous education, housing & employment (since 2022)",
    detail: "Community investment across Indigenous education, housing and employment; TD reports over $25M granted since 2022.",
    targetText: "$25M+ community investment",
    targetYear: 2025,
    history: [h("2022", "in_progress", 40), h("2024", "reported", 78)],
    source: SRC.td,
  }),

  // ── Energy ───────────────────────────────────────────────────────────────
  mk({
    id: "cm-cenovus-proc",
    orgName: "Cenovus Energy",
    sector: "energy",
    orgSize: "enterprise",
    type: "procurement",
    title: "Spend a minimum $1.2B with Indigenous businesses (2019–2025)",
    detail: "Cenovus's cumulative Indigenous business spend target across the 2019 to 2025 period.",
    targetText: "$1.2B cumulative (2019 to 2025)",
    targetYear: 2025,
    history: [h("2021", "in_progress", 45), h("2023", "in_progress", 72), h("2025", "reported", 95)],
    source: SRC.cenovus,
  }),
  mk({
    id: "cm-suncor-proc",
    orgName: "Suncor Energy",
    sector: "energy",
    orgSize: "enterprise",
    type: "procurement",
    title: "Sustain ~20% of total spend (~$3B/yr) with Indigenous suppliers",
    detail: "Indigenous procurement embedded into operations at roughly 20% of total spend (about $3B per year).",
    targetText: "~20% of total spend",
    targetYear: 2024,
    history: [h("2022", "in_progress", 70), h("2023", "reported", 90), h("2024", "reported", 100)],
    source: SRC.suncor,
  }),
  mk({
    id: "cm-hydroone-proc",
    orgName: "Hydro One",
    sector: "energy",
    orgSize: "large",
    type: "procurement",
    title: "Allocate ≥5% of annual procurement to Indigenous suppliers",
    detail: "Hydro One's supplier-diversity target to direct a minimum share of annual procurement to Indigenous businesses.",
    targetText: "at least 5% of annual procurement",
    targetYear: 2025,
    history: [h("2021", "in_progress", 50), h("2023", "in_progress", 66)],
    source: SRC.hydroone,
  }),

  // ── Mining ───────────────────────────────────────────────────────────────
  mk({
    id: "cm-teck-emp",
    orgName: "Teck Resources",
    sector: "mining",
    orgSize: "enterprise",
    type: "employment",
    title: "Increase Indigenous employment representation by end 2025",
    detail: "Increase Indigenous representation across Teck's workforce by the end of 2025.",
    targetText: "higher Indigenous employment by 2025",
    targetYear: 2025,
    history: [h("2023", "committed", 25), h("2024", "in_progress", 48), h("2025", "in_progress", 60)],
    source: SRC.teck,
  }),
  mk({
    id: "cm-teck-rel",
    orgName: "Teck Resources",
    sector: "mining",
    orgSize: "enterprise",
    type: "relationships",
    title: "Contribute $100M to community organizations & initiatives by end 2025",
    detail: "A community contribution target to organizations and initiatives, including Indigenous communities, by end 2025.",
    targetText: "$100M to communities by 2025",
    targetYear: 2025,
    history: [h("2022", "in_progress", 55), h("2024", "reported", 82), h("2025", "reported", 96)],
    source: SRC.teck,
  }),
  mk({
    id: "cm-vale-emp",
    orgName: "Vale Canada",
    sector: "mining",
    orgSize: "enterprise",
    type: "employment",
    title: "Maximize Indigenous employment & business opportunities at Labrador operations",
    detail: "Maximize Indigenous employment and business opportunities at Vale's Labrador operations (Voisey's Bay, Long Harbour).",
    targetText: "Indigenous employment and business in Labrador",
    targetYear: 2025,
    history: [h("2023", "committed", 30), h("2024", "in_progress", 46)],
    source: SRC.vale,
  }),

  // ── Transport ────────────────────────────────────────────────────────────
  mk({
    id: "cm-cn-emp",
    orgName: "CN (Canadian National Railway)",
    sector: "transport",
    orgSize: "enterprise",
    type: "employment",
    title: "Indigenous Reconciliation Plan 2025–2027: implement Indigenous employment strategy",
    detail: "Implement an Indigenous employment strategy under CN's 2025 to 2027 Indigenous Reconciliation Plan.",
    targetText: "Indigenous employment strategy by 2027",
    targetYear: 2027,
    history: [h("2025", "committed", 20), h("2026", "in_progress", 36)],
    source: SRC.cn,
  }),
  mk({
    id: "cm-cn-proc",
    orgName: "CN (Canadian National Railway)",
    sector: "transport",
    orgSize: "enterprise",
    type: "procurement",
    title: "Embed Indigenous engagement questionnaire into all Canadian RFPs",
    detail: "Embed an Indigenous engagement questionnaire into all Canadian requests for proposals; CN reports this completed.",
    targetText: "questionnaire in all Canadian RFPs",
    targetYear: 2025,
    history: [h("2024", "in_progress", 60), h("2025", "reported", 100)],
    source: SRC.cn,
  }),
];
