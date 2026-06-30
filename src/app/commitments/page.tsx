// RAP Index dashboard (client idea #2): commitments by sector, organization size,
// and commitment type, with progress tracking over time. Institute-facing,
// server component reading commitmentsRepo. Filters via searchParams.
import { commitmentsRepo } from "@/lib/commitments";
import type { CommitmentStatus, CommitmentType, Sector } from "@/lib/commitments";

export const dynamic = "force-dynamic";

const SECTORS: Sector[] = [
  "finance", "mining", "energy", "consulting", "retail",
  "health", "government", "education", "transport",
];
const TYPES: CommitmentType[] = [
  "employment", "procurement", "cultural_learning", "governance", "relationships", "anti_racism",
];

const label = (s: string) => s.replace(/_/g, " ");

const STATUS_STYLE: Record<CommitmentStatus, string> = {
  committed: "text-ink3 border-ink/15",
  in_progress: "text-amber border-amber/40 bg-amber/10",
  reported: "text-cedar border-cedar/40 bg-cedar/10",
  confirmed: "text-cedar border-cedar/50 bg-cedar/20",
  stalled: "text-rust border-rust/40 bg-rust/10",
};

function Bar({ value, max }: { value: number; max: number }) {
  const pct = max ? Math.round((value / max) * 100) : 0;
  return (
    <div className="h-3 flex-1 rounded bg-ink/10 overflow-hidden">
      <div className="h-full bg-amber" style={{ width: `${pct}%` }} />
    </div>
  );
}

function GroupSection({
  title,
  rows,
}: {
  title: string;
  rows: [string, { count: number; avgProgress: number }][];
}) {
  const max = Math.max(1, ...rows.map(([, v]) => v.count));
  return (
    <section>
      <div className="text-ink3 text-xs uppercase tracking-widest mb-3">{title}</div>
      <div className="space-y-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center gap-3 text-sm">
            <div className="w-40 shrink-0 capitalize text-ink2">{label(k)}</div>
            <Bar value={v.count} max={max} />
            <div className="w-28 text-right text-ink3">
              {v.count} · {v.avgProgress}% avg
            </div>
          </div>
        ))}
        {rows.length === 0 && <p className="text-ink3 text-sm">No commitments.</p>}
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

  const qs = (next: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const sector = next.sector ?? searchParams.sector;
    const type = next.type ?? searchParams.type;
    if (sector) p.set("sector", sector);
    if (type) p.set("type", type);
    const s = p.toString();
    return s ? `/commitments?${s}` : "/commitments";
  };

  return (
    <div className="space-y-8">
      <div>
        <div className="text-amber text-xs uppercase tracking-widest mb-1">Indigenomics · RAP Index</div>
        <h1 className="font-serif text-3xl">
          Commitments dashboard{" "}
          <span className="text-ink3 text-base">— by sector, size & type, tracked over time</span>
        </h1>
      </div>

      {/* stat cards */}
      <div className="grid sm:grid-cols-4 gap-4">
        <div className="bg-panel rounded border border-line shadow-card p-5">
          <div className="font-serif text-4xl text-amber">{summary.total}</div>
          <div className="text-ink3 text-sm">commitments</div>
        </div>
        <div className="bg-panel rounded border border-line shadow-card p-5">
          <div className="font-serif text-3xl">{summary.orgCount}</div>
          <div className="text-ink3 text-sm">organizations</div>
        </div>
        <div className="bg-panel rounded border border-line shadow-card p-5">
          <div className="font-serif text-3xl">{summary.avgProgress}%</div>
          <div className="text-ink3 text-sm">average progress</div>
        </div>
        <div className="bg-panel rounded border border-line shadow-card p-5">
          <div className="font-serif text-3xl text-cedar">{summary.confirmedPct}%</div>
          <div className="text-ink3 text-sm">confirmed</div>
        </div>
      </div>

      {/* filters */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink3 text-xs uppercase tracking-widest mr-1">Sector</span>
          {SECTORS.map((s) => (
            <a
              key={s}
              href={qs({ sector: searchParams.sector === s ? "" : s })}
              className={`rounded-full border px-3 py-1 capitalize hover:border-amber/50 ${
                searchParams.sector === s ? "border-amber/60 text-amber bg-amber/10" : "border-line text-ink2"
              }`}
            >
              {label(s)} <span className="text-ink3">{summary.bySector[s]?.count ?? 0}</span>
            </a>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink3 text-xs uppercase tracking-widest mr-1">Type</span>
          {TYPES.map((t) => (
            <a
              key={t}
              href={qs({ type: searchParams.type === t ? "" : t })}
              className={`rounded-full border px-3 py-1 capitalize hover:border-amber/50 ${
                searchParams.type === t ? "border-amber/60 text-amber bg-amber/10" : "border-line text-ink2"
              }`}
            >
              {label(t)} <span className="text-ink3">{summary.byType[t]?.count ?? 0}</span>
            </a>
          ))}
          {(searchParams.sector || searchParams.type) && (
            <a href="/commitments" className="text-ink3 underline text-xs ml-1">clear</a>
          )}
        </div>
      </div>

      {/* breakdowns */}
      <div className="grid md:grid-cols-2 gap-8">
        <GroupSection title="By sector" rows={Object.entries(summary.bySector)} />
        <GroupSection title="By commitment type" rows={Object.entries(summary.byType)} />
        <GroupSection title="By organization size" rows={Object.entries(summary.bySize)} />

        {/* progress over time */}
        <section>
          <div className="text-ink3 text-xs uppercase tracking-widest mb-3">Progress over time</div>
          <div className="space-y-2">
            {summary.overTime.map((p) => (
              <div key={p.period} className="flex items-center gap-3 text-sm">
                <div className="w-16 shrink-0 text-ink2">{p.period}</div>
                <Bar value={p.avgProgress} max={100} />
                <div className="w-28 text-right text-ink3">{p.avgProgress}% avg</div>
              </div>
            ))}
            {summary.overTime.length === 0 && <p className="text-ink3 text-sm">No history.</p>}
          </div>
          <p className="text-ink3 text-xs mt-2">
            Average reported progress across all commitments active in each reporting period.
          </p>
        </section>
      </div>

      {/* the commitments themselves */}
      <div>
        <div className="text-ink3 text-xs uppercase tracking-widest mb-2">
          Commitments{searchParams.sector || searchParams.type ? " (filtered)" : ""}
        </div>
        <div className="divide-y divide-ink/10">
          {list.map((c) => (
            <div key={c.id} className="flex items-center gap-3 py-2 text-sm">
              <div className="flex-1">
                <div>{c.title}</div>
                <div className="text-ink3 text-xs">
                  {c.orgName} · <span className="capitalize">{label(c.sector)}</span> ·{" "}
                  <span className="capitalize">{c.orgSize}</span> ·{" "}
                  <span className="capitalize">{label(c.type)}</span> · target {c.targetYear}
                </div>
              </div>
              <span className="font-serif w-12 text-right">{c.progressPct}%</span>
              <span
                className={`text-xs rounded border px-2 py-0.5 capitalize w-24 text-center ${STATUS_STYLE[c.status]}`}
              >
                {label(c.status)}
              </span>
            </div>
          ))}
          {list.length === 0 && <p className="text-ink3 py-2">No commitments match.</p>}
        </div>
      </div>
    </div>
  );
}
