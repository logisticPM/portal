// RAP Index dashboard (client idea #2): commitments by sector, organization size,
// and commitment type, with progress tracking over time. The Indigenomics
// (institute) landing. Server component reading commitmentsRepo; filters via searchParams.
import Link from "next/link";
import { commitmentsRepo, computeRisk, buildInsights, confirmationIntegrity } from "@/lib/commitments";
import type { CommitmentStatus, CommitmentType, OrgSize, RapType, Sector } from "@/lib/commitments";
import { InstituteNav } from "@/components/InstituteNav";
import { RapIndexTabs } from "@/components/RapIndexTabs";
import { CommitmentSearch } from "./CommitmentSearch";
import { PageJump } from "./PageJump";
import { FilterRow } from "@/components/FilterRow";
import { labelFor } from "@/lib/taxonomy";

export const dynamic = "force-dynamic";

// Windowed page numbers: show at most `size` pages, sliding to keep the current
// page centred, so long lists don't dump every page button (e.g. 1..11).
function pageWindow(current: number, total: number, size = 5): number[] {
  if (total <= size) return Array.from({ length: total }, (_, i) => i + 1);
  const half = Math.floor(size / 2);
  const end = Math.min(total, Math.max(current + half, size));
  const start = Math.max(1, end - size + 1);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

// Fixed, meaningful orderings (NOT alphabetical) so the dashboard reads cleanly.
const SECTORS: Sector[] = [
  "finance", "mining", "energy", "consulting", "retail",
  "health", "government", "education", "transport",
  "telecom", "forestry", "construction", "aerospace", "agriculture", "media",
];
const TYPES: CommitmentType[] = [
  "employment", "procurement", "cultural_learning", "governance", "relationships", "anti_racism",
];
const SIZES: OrgSize[] = ["small", "medium", "large", "enterprise"];
const RAP_TYPES: RapType[] = ["reflect", "innovate", "stretch", "elevate"];
const STATUSES: CommitmentStatus[] = ["committed", "in_progress", "reported", "confirmed", "stalled"];

// status → bar fill + pill classes (palette unchanged: ink / amber / cedar / rust)
const STATUS_BG: Record<CommitmentStatus, string> = {
  committed: "bg-ink/25",
  in_progress: "bg-amber",
  reported: "bg-cedar/45",
  confirmed: "bg-cedar",
  stalled: "bg-rust",
};
// SVG fills for the status donut — mirror STATUS_BG using theme CSS vars.
const STATUS_FILL: Record<CommitmentStatus, string> = {
  committed: "rgb(var(--ink) / 0.25)",
  in_progress: "rgb(var(--amber))",
  reported: "rgb(var(--cedar) / 0.45)",
  confirmed: "rgb(var(--cedar))",
  stalled: "rgb(var(--rust))",
};
const STATUS_PILL: Record<CommitmentStatus, string> = {
  committed: "text-ink3 border-ink/15",
  in_progress: "text-amber border-amber/40 bg-amber/10",
  reported: "text-cedar border-cedar/40 bg-cedar/10",
  confirmed: "text-cedar border-cedar/50 bg-cedar/20",
  stalled: "text-rust border-rust/40 bg-rust/10",
};

type Stat = { count: number; avgProgress: number } | undefined;

// Hand-drawn donut (server-rendered, theme-aware). Each segment is a full circle
// whose stroke-dasharray shows only its slice; offsets accumulate around the ring.
function DonutChart({
  segments,
  total,
}: {
  segments: { label: string; value: number; color: string }[];
  total: number;
}) {
  const size = 180;
  const stroke = 26;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const C = 2 * Math.PI * r;
  let acc = 0; // cumulative fraction
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-40 h-40 shrink-0" role="img" aria-label="Status distribution">
      <g transform={`rotate(-90 ${cx} ${cy})`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgb(var(--ink) / 0.06)" strokeWidth={stroke} />
        {segments
          .filter((s) => s.value > 0)
          .map((s) => {
            const frac = total ? s.value / total : 0;
            const dash = frac * C;
            const seg = (
              <circle
                key={s.label}
                cx={cx} cy={cy} r={r} fill="none"
                stroke={s.color} strokeWidth={stroke}
                strokeDasharray={`${dash} ${C - dash}`}
                strokeDashoffset={-acc * C}
              />
            );
            acc += frac;
            return seg;
          })}
      </g>
      <text x={cx} y={cy - 2} textAnchor="middle" fontSize={32} fill="rgb(var(--ink))" style={{ fontFamily: "var(--font-display)" }}>
        {total}
      </text>
      <text x={cx} y={cy + 16} textAnchor="middle" fontSize={11} fill="rgb(var(--ink3))">
        commitments
      </text>
    </svg>
  );
}

// Lead-in shown ABOVE a card (outside it): a heading + one plain-language line
// explaining what the card below shows.
function SectionLead({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <h2 className="font-serif text-xl">{title}</h2>
      <p className="text-ink2 text-sm mt-0.5">{children}</p>
    </div>
  );
}

function GroupSection({
  title,
  keys,
  map,
  dim,
}: {
  title: string;
  keys: string[];
  map: Record<string, { count: number; avgProgress: number }>;
  dim: "sector" | "commitmentType" | "sizeBand";
}) {
  const max = Math.max(1, ...keys.map((k) => map[k]?.count ?? 0));
  return (
    <section className="bg-panel rounded border border-line shadow-card p-5">
      <div className="text-ink3 text-xs uppercase tracking-widest mb-3">{title}</div>
      <div className="space-y-2">
        {keys.map((k) => {
          const s: Stat = map[k];
          const count = s?.count ?? 0;
          return (
            <div key={k} className={`flex items-center gap-3 text-sm ${count ? "" : "opacity-40"}`}>
              <div className="w-32 shrink-0 text-ink2">{labelFor(dim, k)}</div>
              <div className="h-3 flex-1 rounded bg-ink/10 overflow-hidden">
                <div className="h-full bg-amber" style={{ width: `${(count / max) * 100}%` }} />
              </div>
              <div className="w-6 text-right tabular-nums">{count}</div>
              <div className="w-12 text-right text-cedar tabular-nums">{s?.avgProgress ?? 0}%</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default async function CommitmentsPage({
  searchParams,
}: {
  searchParams: {
    sector?: Sector; type?: CommitmentType; year?: string; q?: string; page?: string;
    rfilter?: string; rpage?: string; rsector?: string; rq?: string;
  };
}) {
  const yearNum = searchParams.year ? Number(searchParams.year) : undefined;
  const filter = {
    sector: searchParams.sector,
    type: searchParams.type,
    targetYear: Number.isFinite(yearNum) ? yearNum : undefined,
    q: searchParams.q,
  };
  const [summary, list] = await Promise.all([
    commitmentsRepo.getSummary(filter),
    commitmentsRepo.listCommitments(filter),
  ]);
  // Always offer every year 2015–2030 as a due-year filter (whether or not any
  // commitment currently targets it). Range starts at 2015 to cover landmark
  // earlier commitments (e.g. equity agreements, older procurement targets).
  const YEARS = Array.from({ length: 2030 - 2015 + 1 }, (_, i) => 2015 + i);

  // pagination for the list (10 per page)
  const PAGE_SIZE = 10;
  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const page = Math.min(totalPages, Math.max(1, Number(searchParams.page) || 1));
  const pageItems = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const currentYear = new Date().getFullYear();
  const insights = buildInsights(summary, list, currentYear);
  const risk = computeRisk(list, currentYear);
  const integ = confirmationIntegrity(list);
  const statusCounts = STATUSES.map((s) => ({ status: s, count: list.filter((c) => c.status === s).length }));
  const maxCell = Math.max(
    1,
    ...SECTORS.flatMap((s) => TYPES.map((t) => summary.matrix[s]?.[t] ?? 0)),
  );
  const maxTier = Math.max(1, ...RAP_TYPES.map((r) => summary.byRapType[r]?.count ?? 0));
  const hasRapData = RAP_TYPES.some((r) => (summary.byRapType[r]?.count ?? 0) > 0);

  // Build a /commitments URL, toggling one facet while preserving the others.
  const qs = (next: { sector?: string; type?: string; year?: string; q?: string; page?: string }) => {
    const p = new URLSearchParams();
    const sector = "sector" in next ? next.sector : searchParams.sector;
    const type = "type" in next ? next.type : searchParams.type;
    const year = "year" in next ? next.year : searchParams.year;
    const q = "q" in next ? next.q : searchParams.q;
    // page is preserved only for paginate links; any filter change omits it (resets to 1)
    const pg = "page" in next ? next.page : undefined;
    if (sector) p.set("sector", sector);
    if (type) p.set("type", type);
    if (year) p.set("year", year);
    if (q) p.set("q", q);
    if (pg && pg !== "1") p.set("page", pg);
    // carry the deadline-risk view across main-filter changes
    if (searchParams.rfilter) p.set("rfilter", searchParams.rfilter);
    if (searchParams.rpage && searchParams.rpage !== "1") p.set("rpage", searchParams.rpage);
    if (searchParams.rsector) p.set("rsector", searchParams.rsector);
    if (searchParams.rq) p.set("rq", searchParams.rq);
    const s = p.toString();
    return s ? `/commitments?${s}` : "/commitments";
  };

  // deadline-risk section: its own filter (rfilter) + pagination (rpage), while
  // preserving the main list's filters/page.
  const rqs = (next: { rfilter?: string; rpage?: string; rsector?: string; rq?: string }) => {
    const p = new URLSearchParams();
    if (searchParams.sector) p.set("sector", searchParams.sector);
    if (searchParams.type) p.set("type", searchParams.type);
    if (searchParams.year) p.set("year", searchParams.year);
    if (searchParams.q) p.set("q", searchParams.q);
    if (searchParams.page && searchParams.page !== "1") p.set("page", searchParams.page);
    const rf = "rfilter" in next ? next.rfilter : searchParams.rfilter;
    const rp = "rpage" in next ? next.rpage : searchParams.rpage;
    const rsec = "rsector" in next ? next.rsector : searchParams.rsector;
    const rqv = "rq" in next ? next.rq : searchParams.rq;
    if (rf) p.set("rfilter", rf);
    if (rp && rp !== "1") p.set("rpage", rp);
    if (rsec) p.set("rsector", rsec);
    if (rqv) p.set("rq", rqv);
    const s = p.toString();
    return s ? `/commitments?${s}` : "/commitments";
  };

  // classify every commitment for the risk table (overdue / at_risk / on_track)
  const flagById = new Map(risk.flags.map((f) => [f.commitment.id, f]));
  const riskRows = list.map((c) => {
    const f = flagById.get(c.id);
    return { commitment: c, kind: f?.kind ?? "on_track", reason: f?.reason ?? `${labelFor("status", c.status)} · ${c.progressPct}%` };
  });
  const rfilter = searchParams.rfilter;
  const rsector = searchParams.rsector;
  const rqText = (searchParams.rq ?? "").trim().toLowerCase();
  const riskSectorFacets = [...new Set(riskRows.map((r) => r.commitment.sector))].sort();
  const riskFiltered = riskRows.filter(
    (r) =>
      (!rfilter || r.kind === rfilter) &&
      (!rsector || r.commitment.sector === rsector) &&
      (!rqText ||
        [r.commitment.title, r.commitment.orgName, r.commitment.detail, r.commitment.targetText]
          .filter(Boolean)
          .some((s) => String(s).toLowerCase().includes(rqText))),
  );
  const R_SIZE = 10;
  const rTotalPages = Math.max(1, Math.ceil(riskFiltered.length / R_SIZE));
  const rpage = Math.min(rTotalPages, Math.max(1, Number(searchParams.rpage) || 1));
  const riskPageItems = riskFiltered.slice((rpage - 1) * R_SIZE, rpage * R_SIZE);
  const RISK_BADGE: Record<string, string> = {
    overdue: "text-rust border-rust/40 bg-rust/10",
    at_risk: "text-amber border-amber/40 bg-amber/10",
    on_track: "text-cedar border-cedar/40 bg-cedar/10",
  };
  const RISK_TABS: { id: string; label: string; n: number }[] = [
    { id: "overdue", label: "Overdue", n: risk.overdueCount },
    { id: "at_risk", label: "At risk", n: risk.atRiskCount },
    { id: "on_track", label: "On track", n: risk.onTrackCount },
  ];

  const hasFilter = !!(searchParams.sector || searchParams.type || searchParams.year || searchParams.q);
  const exportQs = qs({}).replace("/commitments", ""); // "" or "?..."

  return (
    <div className="space-y-8">
      <InstituteNav active="/commitments" />
      <RapIndexTabs active="table" />

      <div>
        <h1 className="font-serif text-3xl">
          The RAP Index{" "}
          <span className="text-ink3 text-base">· commitments by sector, size & type</span>
        </h1>
        <p className="text-ink2 text-sm mt-1">
          Reconciliation commitments across the network, and how they progress over time. Distinct
          from{" "}
          <a href="/analytics" className="text-amber hover:underline">Spend Coverage</a>, which tracks
          confirmed dollars.
        </p>
      </div>

      {/* auto-generated narrative analysis */}
      <div>
        <SectionLead title="Key takeaways">
          Plain-language highlights, generated automatically from the data below. Start here.
        </SectionLead>
        <section className="bg-panel rounded border border-line shadow-card p-5">
        <ul className="space-y-2 text-sm">
          {insights.map((line, i) => (
            <li key={i} className="flex gap-2.5">
              <span className="text-amber mt-0.5 shrink-0">›</span>
              <span className="text-ink2">{line}</span>
            </li>
          ))}
        </ul>
        <p className="text-ink3 text-[11px] mt-3">
          Generated from the data below · reflects the current filter.
        </p>
        </section>
      </div>

      {/* KPI strip */}
      <div>
        <SectionLead title="At a glance">
          The headline totals for the current view: commitments, organizations, average progress, and
          the confirmed share.
        </SectionLead>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-panel rounded border border-line shadow-card p-5">
          <div className="font-serif text-4xl text-amber">{summary.total}</div>
          <div className="text-ink3 text-sm">commitments</div>
        </div>
        <div className="bg-panel rounded border border-line shadow-card p-5">
          <div className="font-serif text-4xl">{summary.orgCount}</div>
          <div className="text-ink3 text-sm">organizations</div>
        </div>
        <div className="bg-panel rounded border border-line shadow-card p-5">
          <div className="font-serif text-4xl">{summary.avgProgress}%</div>
          <div className="text-ink3 text-sm">average progress</div>
        </div>
        <div className="bg-panel rounded border border-line shadow-card p-5">
          <div className="font-serif text-4xl text-cedar">{summary.confirmedPct}%</div>
          <div className="text-ink3 text-sm">confirmed</div>
        </div>
        </div>
      </div>

      {/* status snapshot — where every commitment stands right now */}
      <div>
        <SectionLead title="Status snapshot">
          Where every commitment sits right now, from committed, through in-progress and reported, to
          confirmed (or stalled).
        </SectionLead>
        <section className="bg-panel rounded border border-line shadow-card p-5">
        <div className="flex flex-wrap items-center gap-6">
          <DonutChart
            segments={statusCounts.map(({ status, count }) => ({
              label: status,
              value: count,
              color: STATUS_FILL[status],
            }))}
            total={list.length}
          />
          <div className="flex-1 min-w-[200px] space-y-2">
            {statusCounts.map(({ status, count }) => {
              const pct = list.length ? Math.round((count / list.length) * 100) : 0;
              return (
                <div key={status} className={`flex items-center gap-3 text-sm ${count ? "" : "opacity-40"}`}>
                  <span className={`inline-block h-3 w-3 rounded-sm ${STATUS_BG[status]}`} />
                  <span className="flex-1">{labelFor("status", status)}</span>
                  <span className="tabular-nums text-ink2">{count}</span>
                  <span className="tabular-nums text-ink3 w-10 text-right">{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>
        </section>
      </div>

      {/* confirmation integrity — the report→confirm lens */}
      <div>
        <SectionLead title="Confirmation integrity">
          Of the outcomes organizations have claimed (reported or confirmed), how many are actually
          supplier-confirmed, versus still self-reported and unverified.
        </SectionLead>
        <section className="bg-panel rounded border border-line shadow-card p-5">
        {integ.claimed === 0 ? (
          <p className="text-ink3 text-sm">No reported or confirmed outcomes yet.</p>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <span className="font-serif text-3xl text-cedar">{integ.confirmationRate}%</span>
              <span className="text-ink2 text-sm">
                of {integ.claimed} claimed outcomes are supplier-confirmed. The rest are self-reported
                and unverified.
              </span>
            </div>
            <div className="mt-3 h-3 rounded bg-ink/10 overflow-hidden flex">
              <div
                className="h-full bg-cedar"
                style={{ width: `${(integ.confirmed / integ.claimed) * 100}%` }}
                title={`Confirmed: ${integ.confirmed}`}
              />
              <div
                className="h-full bg-amber/50"
                style={{ width: `${(integ.selfReported / integ.claimed) * 100}%` }}
                title={`Self-reported: ${integ.selfReported}`}
              />
            </div>
            <div className="mt-2 flex gap-4 text-xs text-ink3">
              <span>
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-cedar mr-1" />
                {integ.confirmed} confirmed
              </span>
              <span>
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber/50 mr-1" />
                {integ.selfReported} self-reported (unverified)
              </span>
            </div>
          </>
        )}
        </section>
      </div>

      {/* progress over time — the centerpiece: stacked status mix per period */}
      <div>
        <SectionLead title="Progress over time">
          How the mix of statuses and the average progress have shifted across reporting periods.
        </SectionLead>
        <section className="bg-panel rounded border border-line shadow-card p-5">
        <div className="flex flex-wrap items-baseline justify-end gap-2 mb-3">
          <div className="flex flex-wrap gap-3 text-xs text-ink3">
            {STATUSES.map((s) => (
              <span key={s} className="inline-flex items-center gap-1">
                <span className={`inline-block h-2.5 w-2.5 rounded-sm ${STATUS_BG[s]}`} />
                {labelFor("status", s)}
              </span>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          {summary.overTime.map((p) => {
            const total = STATUSES.reduce((n, s) => n + (p.byStatus[s] ?? 0), 0);
            return (
              <div key={p.period} className="flex items-center gap-3 text-sm">
                <div className="w-12 shrink-0 text-ink2 tabular-nums">{p.period}</div>
                <div className="h-4 flex-1 rounded overflow-hidden bg-ink/5 flex">
                  {STATUSES.map((s) => {
                    const n = p.byStatus[s] ?? 0;
                    if (!n) return null;
                    return (
                      <div
                        key={s}
                        className={STATUS_BG[s]}
                        style={{ width: `${(n / total) * 100}%` }}
                        title={`${labelFor("status", s)}: ${n}`}
                      />
                    );
                  })}
                </div>
                <div className="w-20 text-right text-ink3 tabular-nums">{p.avgProgress}% avg</div>
              </div>
            );
          })}
          {summary.overTime.length === 0 && <p className="text-ink3 text-sm">No history.</p>}
        </div>
        </section>
      </div>

      {/* deadline & delivery risk */}
      <div>
        <SectionLead title="Deadline & delivery risk">
          Every commitment classified as overdue, at risk, or on track. Filter and page through them.
        </SectionLead>
        <section className="bg-panel rounded border border-line shadow-card p-5 space-y-3">
          {/* search + clear */}
          <div className="flex flex-wrap items-center gap-2">
            <CommitmentSearch
              basePath="/commitments"
              param="rq"
              resetParam="rpage"
              placeholder="Search these commitments…"
            />
            {(rfilter || rsector || rqText) && (
              <Link href={rqs({ rfilter: undefined, rsector: undefined, rq: undefined, rpage: undefined })} scroll={false} className="text-ink3 underline text-xs">
                clear
              </Link>
            )}
          </div>

          {/* sector filter */}
          <FilterRow label="Sector">
            {riskSectorFacets.map((s) => (
              <Link
                key={s}
                scroll={false}
                href={rqs({ rsector: rsector === s ? undefined : s, rpage: undefined })}
                className={`rounded-full border px-2.5 py-0.5 hover:border-amber/50 ${
                  rsector === s ? "border-amber/60 text-amber bg-amber/10" : "border-line text-ink2"
                }`}
              >
                {labelFor("sector", s)}
              </Link>
            ))}
          </FilterRow>

          {/* status filter tabs */}
          <FilterRow label="Status">
            {RISK_TABS.map((t) => (
              <Link
                key={t.id}
                scroll={false}
                href={rqs({ rfilter: rfilter === t.id ? undefined : t.id, rpage: undefined })}
                className={`rounded-full border px-2.5 py-0.5 ${
                  rfilter === t.id ? "border-amber/60 text-amber bg-amber/10" : "border-line text-ink2 hover:border-amber/50"
                }`}
              >
                {t.label} · {t.n}
              </Link>
            ))}
            {rfilter && (
              <Link href={rqs({ rfilter: undefined, rpage: undefined })} scroll={false} className="text-ink3 underline">
                clear
              </Link>
            )}
          </FilterRow>

          {riskPageItems.length === 0 ? (
            <p className="text-ink3 text-sm">Nothing here.</p>
          ) : (
            <div className="divide-y divide-ink/10">
              {riskPageItems.map((r) => (
                <div key={r.commitment.id} className="flex items-center gap-3 py-2 text-sm">
                  <span className={`w-16 shrink-0 text-xs rounded border px-2 py-0.5 text-center capitalize ${RISK_BADGE[r.kind]}`}>
                    {r.kind.replace(/_/g, " ")}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{r.commitment.title}</div>
                    <div className="text-ink3 text-xs">
                      {r.commitment.orgName} · <span>{labelFor("sector", r.commitment.sector)}</span>
                    </div>
                  </div>
                  <span className="text-ink3 text-xs whitespace-nowrap">{r.reason}</span>
                </div>
              ))}
            </div>
          )}

          {/* pagination */}
          {riskFiltered.length > R_SIZE && (
            <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
              <span className="text-ink3">
                {(rpage - 1) * R_SIZE + 1}–{Math.min(rpage * R_SIZE, riskFiltered.length)} of {riskFiltered.length}
              </span>
              <div className="flex items-center gap-1 ml-auto">
                {rpage > 1 ? (
                  <Link href={rqs({ rpage: String(rpage - 1) })} scroll={false} className="rounded border border-line px-2 py-1 text-ink2 hover:text-ink hover:border-ink/30">‹ Prev</Link>
                ) : (
                  <span className="rounded border border-line px-2 py-1 text-ink3 opacity-40">‹ Prev</span>
                )}
                {pageWindow(rpage, rTotalPages).map((n) => (
                  <Link
                    key={n}
                    href={rqs({ rpage: String(n) })}
                    scroll={false}
                    className={`rounded border px-2.5 py-1 tabular-nums ${
                      n === rpage ? "border-amber/60 text-amber bg-amber/10" : "border-line text-ink2 hover:text-ink hover:border-ink/30"
                    }`}
                  >
                    {n}
                  </Link>
                ))}
                {rpage < rTotalPages ? (
                  <Link href={rqs({ rpage: String(rpage + 1) })} scroll={false} className="rounded border border-line px-2 py-1 text-ink2 hover:text-ink hover:border-ink/30">Next ›</Link>
                ) : (
                  <span className="rounded border border-line px-2 py-1 text-ink3 opacity-40">Next ›</span>
                )}
                <PageJump totalPages={rTotalPages} basePath="/commitments" param="rpage" />
              </div>
            </div>
          )}
        </section>
      </div>

      {/* breakdowns — aligned 3-up */}
      <div>
        <SectionLead title="Breakdowns">
          Commitment counts and average progress by sector, commitment type, and organization size.
        </SectionLead>
        <div className="grid lg:grid-cols-3 gap-4">
        <GroupSection title="By sector" keys={SECTORS} map={summary.bySector} dim="sector" />
        <GroupSection title="By commitment type" keys={TYPES} map={summary.byType} dim="commitmentType" />
        <GroupSection title="By organization size" keys={SIZES} map={summary.bySize} dim="sizeBand" />
        </div>
      </div>

      {/* RAP maturity — 4 tiers side by side (only when the data has tiers) */}
      {hasRapData && (
      <div>
        <SectionLead title="RAP maturity">
          Commitments and average progress by RAP tier (reflect → innovate → stretch → elevate).
        </SectionLead>
        <section className="bg-panel rounded border border-line shadow-card p-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {RAP_TYPES.map((r) => {
            const s = summary.byRapType[r];
            const count = s?.count ?? 0;
            return (
              <div key={r} className={`rounded border border-line p-4 ${count ? "" : "opacity-40"}`}>
                <div className="capitalize text-ink2 text-sm">{r}</div>
                <div className="font-serif text-3xl mt-1">{count}</div>
                <div className="text-ink3 text-xs">commitments</div>
                <div className="h-2 rounded bg-ink/10 overflow-hidden mt-3">
                  <div className="h-full bg-cedar" style={{ width: `${s?.avgProgress ?? 0}%` }} />
                </div>
                <div className="text-cedar text-xs mt-1 tabular-nums">{s?.avgProgress ?? 0}% avg progress</div>
              </div>
            );
          })}
        </div>
        </section>
      </div>
      )}

      {/* sector × type heatmap */}
      <div>
        <SectionLead title="Where commitments concentrate">
          A sector × commitment-type grid. Darker cells mean more commitments in that combination.
        </SectionLead>
        <section className="bg-panel rounded border border-line shadow-card p-5">
        <div className="overflow-x-auto">
          <div className="min-w-[560px]">
            {/* header row */}
            <div className="grid gap-1 mb-1" style={{ gridTemplateColumns: `120px repeat(${TYPES.length}, 1fr)` }}>
              <div />
              {TYPES.map((t) => (
                <div key={t} className="text-ink3 text-[10px] uppercase tracking-wide text-center leading-tight">
                  {labelFor("commitmentType", t)}
                </div>
              ))}
            </div>
            {SECTORS.map((s) => (
              <div
                key={s}
                className="grid gap-1 mb-1 items-center"
                style={{ gridTemplateColumns: `120px repeat(${TYPES.length}, 1fr)` }}
              >
                <div className="text-ink2 text-xs pr-2">{labelFor("sector", s)}</div>
                {TYPES.map((t) => {
                  const n = summary.matrix[s]?.[t] ?? 0;
                  const alpha = n ? (0.14 + 0.62 * (n / maxCell)).toFixed(3) : "0";
                  return (
                    <div
                      key={t}
                      className="h-9 rounded flex items-center justify-center text-xs tabular-nums"
                      style={{
                        backgroundColor: n ? `rgb(var(--amber) / ${alpha})` : "rgb(var(--ink) / 0.04)",
                        color: n ? "rgb(var(--ink))" : "transparent",
                      }}
                      title={`${labelFor("sector", s)} · ${labelFor("commitmentType", t)}: ${n}`}
                    >
                      {n || ""}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        </section>
      </div>

      {/* filters + the commitments themselves */}
      <div>
        <SectionLead title="All commitments">
          The full list behind the numbers above. Filter by sector or type, or export to CSV.
        </SectionLead>
        <section className="bg-panel rounded border border-line shadow-card p-5 space-y-4">
        <div className="space-y-3">
          {/* search + export */}
          <div className="flex flex-wrap items-center gap-2">
            <CommitmentSearch />
            <a
              href={`/api/commitments/export${exportQs}`}
              className="rounded border border-line px-3 py-1.5 text-xs text-ink2 hover:text-ink hover:border-ink/30"
            >
              ↓ Export CSV
            </a>
            {hasFilter && (
              <Link href="/commitments" scroll={false} className="text-ink3 underline text-xs">clear all</Link>
            )}
          </div>

          {/* sector */}
          <FilterRow label="Sector">
            {SECTORS.map((s) => (
              <Link
                key={s}
                scroll={false}
                href={qs({ sector: searchParams.sector === s ? undefined : s })}
                className={`rounded-full border px-2.5 py-0.5 hover:border-amber/50 ${
                  searchParams.sector === s ? "border-amber/60 text-amber bg-amber/10" : "border-line text-ink2"
                }`}
              >
                {labelFor("sector", s)}
              </Link>
            ))}
          </FilterRow>

          {/* commitment type */}
          <FilterRow label="Type">
            {TYPES.map((t) => (
              <Link
                key={t}
                scroll={false}
                href={qs({ type: searchParams.type === t ? undefined : t })}
                className={`rounded-full border px-2.5 py-0.5 hover:border-amber/50 ${
                  searchParams.type === t ? "border-amber/60 text-amber bg-amber/10" : "border-line text-ink2"
                }`}
              >
                {labelFor("commitmentType", t)}
              </Link>
            ))}
          </FilterRow>

          {/* due year */}
          <FilterRow label="Due year">
            {YEARS.map((y) => (
              <Link
                key={y}
                scroll={false}
                href={qs({ year: searchParams.year === String(y) ? undefined : String(y) })}
                className={`rounded-full border px-2.5 py-0.5 tabular-nums hover:border-amber/50 ${
                  searchParams.year === String(y) ? "border-amber/60 text-amber bg-amber/10" : "border-line text-ink2"
                }`}
              >
                {y}
              </Link>
            ))}
          </FilterRow>
        </div>

        <div className="divide-y divide-ink/10">
          {pageItems.map((c) => (
            <details key={c.id} className="group">
              <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-center gap-3 py-2 text-sm">
                <span className="text-ink3 text-xs shrink-0 transition-transform group-open:rotate-90">›</span>
                <div className="flex-1 min-w-0">
                  <div className="truncate">{c.title}</div>
                  <div className="text-ink3 text-xs">
                    {c.orgName} · <span>{labelFor("sector", c.sector)}</span> ·{" "}
                    <span>{labelFor("sizeBand", c.orgSize)}</span> ·{" "}
                    <span>{labelFor("commitmentType", c.type)}</span> · target {c.targetYear}
                  </div>
                </div>
                <span className="font-serif w-12 text-right tabular-nums">{c.progressPct}%</span>
                <span
                  className={`text-xs rounded border px-2 py-0.5 w-24 text-center ${STATUS_PILL[c.status]}`}
                >
                  {labelFor("status", c.status)}
                </span>
              </summary>

              <div className="pl-6 pr-1 pb-4 pt-1 space-y-3 text-sm">
                {(c.detail || c.targetText) && (
                  <p className="text-ink2">
                    {c.detail}
                    {c.targetText ? <> · target <span className="text-ink">{c.targetText}</span></> : null}
                    {" · due "}{c.targetYear}
                  </p>
                )}

                {/* single progress bar */}
                <div className="flex items-center gap-3">
                  <div className="h-2 flex-1 rounded bg-ink/10 overflow-hidden">
                    <div className={`h-full ${STATUS_BG[c.status]}`} style={{ width: `${c.progressPct}%` }} />
                  </div>
                  <span className="text-xs text-ink3 w-28 text-right">{labelFor("status", c.status)} · {c.progressPct}%</span>
                </div>

                {/* provenance + source */}
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full border border-line text-ink3 px-2 py-0.5">Self-reported</span>
                  {c.source && (
                    <a href={c.source.url} target="_blank" rel="noreferrer" className="text-amber hover:underline">
                      Source: {c.source.label} ↗
                    </a>
                  )}
                </div>
              </div>
            </details>
          ))}
          {list.length === 0 && <p className="text-ink3 py-2">No commitments match.</p>}
        </div>

        {/* pagination */}
        {list.length > PAGE_SIZE && (
          <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
            <span className="text-ink3">
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, list.length)} of {list.length}
            </span>
            <div className="flex items-center gap-1 ml-auto">
              {page > 1 ? (
                <Link href={qs({ page: String(page - 1) })} scroll={false} className="rounded border border-line px-2 py-1 text-ink2 hover:text-ink hover:border-ink/30">
                  ‹ Prev
                </Link>
              ) : (
                <span className="rounded border border-line px-2 py-1 text-ink3 opacity-40">‹ Prev</span>
              )}
              {pageWindow(page, totalPages).map((n) => (
                <Link
                  key={n}
                  href={qs({ page: String(n) })}
                  scroll={false}
                  className={`rounded border px-2.5 py-1 tabular-nums ${
                    n === page ? "border-amber/60 text-amber bg-amber/10" : "border-line text-ink2 hover:text-ink hover:border-ink/30"
                  }`}
                >
                  {n}
                </Link>
              ))}
              {page < totalPages ? (
                <Link href={qs({ page: String(page + 1) })} scroll={false} className="rounded border border-line px-2 py-1 text-ink2 hover:text-ink hover:border-ink/30">
                  Next ›
                </Link>
              ) : (
                <span className="rounded border border-line px-2 py-1 text-ink3 opacity-40">Next ›</span>
              )}
              <PageJump totalPages={totalPages} />
            </div>
          </div>
        )}
        </section>
      </div>

      <p className="text-ink3 text-[11px]">
        Seeded from Canadian companies&apos; own public reconciliation / ESG reports (see each
        &ldquo;source&rdquo; link). These are self-reported commitments, not supplier-confirmed;
        confirmation is the layer the portal adds. Not Indigenous data.
      </p>
    </div>
  );
}
