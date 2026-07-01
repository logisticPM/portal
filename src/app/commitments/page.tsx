// RAP Index dashboard (client idea #2): commitments by sector, organization size,
// and commitment type, with progress tracking over time. The Indigenomics
// (institute) landing. Server component reading commitmentsRepo; filters via searchParams.
import { commitmentsRepo, computeRisk, buildInsights } from "@/lib/commitments";
import type { CommitmentStatus, CommitmentType, OrgSize, RapType, Sector } from "@/lib/commitments";
import { InstituteNav } from "@/components/InstituteNav";

export const dynamic = "force-dynamic";

// Fixed, meaningful orderings (NOT alphabetical) so the dashboard reads cleanly.
const SECTORS: Sector[] = [
  "finance", "mining", "energy", "consulting", "retail",
  "health", "government", "education", "transport",
];
const TYPES: CommitmentType[] = [
  "employment", "procurement", "cultural_learning", "governance", "relationships", "anti_racism",
];
const SIZES: OrgSize[] = ["small", "medium", "large", "enterprise"];
const RAP_TYPES: RapType[] = ["reflect", "innovate", "stretch", "elevate"];
const STATUSES: CommitmentStatus[] = ["committed", "in_progress", "reported", "confirmed", "stalled"];

const label = (s: string) => s.replace(/_/g, " ");

// status → bar fill + pill classes (palette unchanged: ink / amber / cedar / rust)
const STATUS_BG: Record<CommitmentStatus, string> = {
  committed: "bg-ink/25",
  in_progress: "bg-amber",
  reported: "bg-cedar/45",
  confirmed: "bg-cedar",
  stalled: "bg-rust",
};
const STATUS_PILL: Record<CommitmentStatus, string> = {
  committed: "text-ink3 border-ink/15",
  in_progress: "text-amber border-amber/40 bg-amber/10",
  reported: "text-cedar border-cedar/40 bg-cedar/10",
  confirmed: "text-cedar border-cedar/50 bg-cedar/20",
  stalled: "text-rust border-rust/40 bg-rust/10",
};

type Stat = { count: number; avgProgress: number } | undefined;

function GroupSection({
  title,
  keys,
  map,
}: {
  title: string;
  keys: string[];
  map: Record<string, { count: number; avgProgress: number }>;
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
              <div className="w-32 shrink-0 capitalize text-ink2">{label(k)}</div>
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
  searchParams: { sector?: Sector; type?: CommitmentType };
}) {
  const filter = { sector: searchParams.sector, type: searchParams.type };
  const [summary, list] = await Promise.all([
    commitmentsRepo.getSummary(filter),
    commitmentsRepo.listCommitments(filter),
  ]);

  const currentYear = new Date().getFullYear();
  const insights = buildInsights(summary, list, currentYear);
  const risk = computeRisk(list, currentYear);
  const maxCell = Math.max(
    1,
    ...SECTORS.flatMap((s) => TYPES.map((t) => summary.matrix[s]?.[t] ?? 0)),
  );
  const maxTier = Math.max(1, ...RAP_TYPES.map((r) => summary.byRapType[r]?.count ?? 0));

  const qs = (next: { sector?: string; type?: string }) => {
    const p = new URLSearchParams();
    const sector = "sector" in next ? next.sector : searchParams.sector;
    const type = "type" in next ? next.type : searchParams.type;
    if (sector) p.set("sector", sector);
    if (type) p.set("type", type);
    const s = p.toString();
    return s ? `/commitments?${s}` : "/commitments";
  };

  return (
    <div className="space-y-8">
      <InstituteNav active="/commitments" />

      <div>
        <h1 className="font-serif text-3xl">
          The RAP Index{" "}
          <span className="text-ink3 text-base">— commitments by sector, size & type</span>
        </h1>
        <p className="text-ink2 text-sm mt-1">
          Reconciliation commitments across the network, and how they progress over time.
        </p>
      </div>

      {/* auto-generated narrative analysis */}
      <section className="bg-panel rounded border border-line shadow-card p-5">
        <div className="text-ink3 text-xs uppercase tracking-widest mb-3">Key takeaways</div>
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

      {/* KPI strip */}
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

      {/* progress over time — the centerpiece: stacked status mix per period */}
      <section className="bg-panel rounded border border-line shadow-card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <div className="text-ink3 text-xs uppercase tracking-widest">Progress over time</div>
          <div className="flex flex-wrap gap-3 text-xs text-ink3">
            {STATUSES.map((s) => (
              <span key={s} className="inline-flex items-center gap-1 capitalize">
                <span className={`inline-block h-2.5 w-2.5 rounded-sm ${STATUS_BG[s]}`} />
                {label(s)}
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
                        title={`${label(s)}: ${n}`}
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

      {/* deadline & delivery risk */}
      <section className="bg-panel rounded border border-line shadow-card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <div className="text-ink3 text-xs uppercase tracking-widest">Deadline &amp; delivery risk</div>
          <div className="flex gap-4 text-xs">
            <span className="text-rust">{risk.overdueCount} overdue</span>
            <span className="text-amber">{risk.atRiskCount} at risk</span>
            <span className="text-cedar">{risk.onTrackCount} on track / done</span>
          </div>
        </div>
        {risk.flags.length === 0 ? (
          <p className="text-ink3 text-sm">Nothing overdue or behind pace. 🎉</p>
        ) : (
          <div className="divide-y divide-ink/10">
            {risk.flags.map((f) => (
              <div key={f.commitment.id} className="flex items-center gap-3 py-2 text-sm">
                <span
                  className={`w-16 shrink-0 text-xs rounded border px-2 py-0.5 text-center capitalize ${
                    f.kind === "overdue"
                      ? "text-rust border-rust/40 bg-rust/10"
                      : "text-amber border-amber/40 bg-amber/10"
                  }`}
                >
                  {label(f.kind)}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="truncate">{f.commitment.title}</div>
                  <div className="text-ink3 text-xs">
                    {f.commitment.orgName} · <span className="capitalize">{label(f.commitment.sector)}</span>
                  </div>
                </div>
                <span className="text-ink3 text-xs whitespace-nowrap">{f.reason}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* breakdowns — aligned 3-up */}
      <div className="grid lg:grid-cols-3 gap-4">
        <GroupSection title="By sector" keys={SECTORS} map={summary.bySector} />
        <GroupSection title="By commitment type" keys={TYPES} map={summary.byType} />
        <GroupSection title="By organization size" keys={SIZES} map={summary.bySize} />
      </div>

      {/* RAP maturity — 4 tiers side by side */}
      <section className="bg-panel rounded border border-line shadow-card p-5">
        <div className="text-ink3 text-xs uppercase tracking-widest mb-4">
          By RAP maturity{" "}
          <span className="normal-case tracking-normal text-ink3">— reflect → innovate → stretch → elevate</span>
        </div>
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

      {/* sector × type heatmap */}
      <section className="bg-panel rounded border border-line shadow-card p-5">
        <div className="text-ink3 text-xs uppercase tracking-widest mb-4">
          Sector × commitment type{" "}
          <span className="normal-case tracking-normal text-ink3">— where commitments concentrate</span>
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[560px]">
            {/* header row */}
            <div className="grid gap-1 mb-1" style={{ gridTemplateColumns: `120px repeat(${TYPES.length}, 1fr)` }}>
              <div />
              {TYPES.map((t) => (
                <div key={t} className="text-ink3 text-[10px] uppercase tracking-wide text-center leading-tight capitalize">
                  {label(t)}
                </div>
              ))}
            </div>
            {SECTORS.map((s) => (
              <div
                key={s}
                className="grid gap-1 mb-1 items-center"
                style={{ gridTemplateColumns: `120px repeat(${TYPES.length}, 1fr)` }}
              >
                <div className="text-ink2 text-xs capitalize pr-2">{label(s)}</div>
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
                      title={`${label(s)} · ${label(t)}: ${n}`}
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

      {/* filters + the commitments themselves */}
      <section className="bg-panel rounded border border-line shadow-card p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink3 text-xs uppercase tracking-widest mr-1">Filter</span>
          {SECTORS.map((s) => (
            <a
              key={s}
              href={qs({ sector: searchParams.sector === s ? undefined : s })}
              className={`rounded-full border px-3 py-1 capitalize text-xs hover:border-amber/50 ${
                searchParams.sector === s ? "border-amber/60 text-amber bg-amber/10" : "border-line text-ink2"
              }`}
            >
              {label(s)}
            </a>
          ))}
          {(searchParams.sector || searchParams.type) && (
            <a href="/commitments" className="text-ink3 underline text-xs ml-1">clear</a>
          )}
        </div>

        <div className="divide-y divide-ink/10">
          {list.map((c) => (
            <div key={c.id} className="flex items-center gap-3 py-2 text-sm">
              <div className="flex-1 min-w-0">
                <div className="truncate">{c.title}</div>
                <div className="text-ink3 text-xs">
                  {c.orgName} · <span className="capitalize">{label(c.sector)}</span> ·{" "}
                  <span className="capitalize">{c.orgSize}</span> ·{" "}
                  <span className="capitalize">{label(c.type)}</span> · target {c.targetYear}
                </div>
              </div>
              <span className="font-serif w-12 text-right tabular-nums">{c.progressPct}%</span>
              <span
                className={`text-xs rounded border px-2 py-0.5 capitalize w-24 text-center ${STATUS_PILL[c.status]}`}
              >
                {label(c.status)}
              </span>
            </div>
          ))}
          {list.length === 0 && <p className="text-ink3 py-2">No commitments match.</p>}
        </div>
      </section>
    </div>
  );
}
