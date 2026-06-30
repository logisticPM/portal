// RAP Index dashboard (client idea #2): commitments by sector, organization size,
// and commitment type, with progress tracking over time. The Indigenomics
// (institute) landing. Server component reading commitmentsRepo; filters via searchParams.
import { commitmentsRepo } from "@/lib/commitments";
import type { CommitmentStatus, CommitmentType, OrgSize, Sector } from "@/lib/commitments";

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

  const qs = (next: { sector?: string; type?: string }) => {
    const p = new URLSearchParams();
    const sector = "sector" in next ? next.sector : searchParams.sector;
    const type = "type" in next ? next.type : searchParams.type;
    if (sector) p.set("sector", sector);
    if (type) p.set("type", type);
    const s = p.toString();
    return s ? `/commitments?${s}` : "/commitments";
  };

  const tabs = [
    { href: "/commitments", label: "RAP Index" },
    { href: "/analytics", label: "Coverage analysis" },
    { href: "/verify", label: "Verification" },
  ];

  return (
    <div className="space-y-8">
      {/* institute sub-nav */}
      <nav className="flex flex-wrap items-center gap-1 border-b border-line pb-3">
        <span className="text-amber text-xs uppercase tracking-widest mr-3">Indigenomics</span>
        {tabs.map((t) => (
          <a
            key={t.href}
            href={t.href}
            className={`text-sm rounded px-3 py-1 ${
              t.href === "/commitments" ? "bg-amber/10 text-amber" : "text-ink2 hover:text-ink"
            }`}
          >
            {t.label}
          </a>
        ))}
      </nav>

      <div>
        <h1 className="font-serif text-3xl">
          The RAP Index{" "}
          <span className="text-ink3 text-base">— commitments by sector, size & type</span>
        </h1>
        <p className="text-ink2 text-sm mt-1">
          Reconciliation commitments across the network, and how they progress over time.
        </p>
      </div>

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

      {/* breakdowns — aligned 3-up */}
      <div className="grid lg:grid-cols-3 gap-4">
        <GroupSection title="By sector" keys={SECTORS} map={summary.bySector} />
        <GroupSection title="By commitment type" keys={TYPES} map={summary.byType} />
        <GroupSection title="By organization size" keys={SIZES} map={summary.bySize} />
      </div>

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
