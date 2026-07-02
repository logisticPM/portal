// RAP Index dashboard. Data source: the RAP extraction domain (src/lib/rap) —
// commitments extracted from real RAP/ESG PDFs (grounded, human-reviewed). This
// page keeps the analytics/layout; each row expands inline (<details>) to the full
// commitment card + a record-progress form. Native rap taxonomy (sector/type/
// pillar/claimBasis) is used directly so nothing is lost mapping into a smaller set.
import { rapRepo } from "@/lib/rap";
import type { ClaimBasis, CommitmentType, Pillar, ProgressStatus, Sector } from "@/lib/rap";
import { InstituteNav } from "@/components/InstituteNav";
import { recordProgressAction } from "./rap-actions";

export const dynamic = "force-dynamic";

const SECTORS: Sector[] = [
  "mining_extractive", "finance_banking", "telecom", "energy",
  "government", "retail", "transport", "other",
];
const TYPES: CommitmentType[] = [
  "procurement", "employment", "education_training", "cultural_awareness",
  "community_investment", "governance", "environmental", "partnership", "other",
];
const STATUSES: ProgressStatus[] = ["not_started", "on_track", "delayed", "met", "missed"];
const CLAIMS: ClaimBasis[] = ["self_reported", "statutory", "independently_verified"];

const sectorLabel: Record<Sector, string> = {
  mining_extractive: "Mining / extractive", finance_banking: "Finance / banking", telecom: "Telecom",
  energy: "Energy", government: "Government", retail: "Retail", transport: "Transport", other: "Other",
};
const typeLabel: Record<CommitmentType, string> = {
  procurement: "Procurement", employment: "Employment", education_training: "Education / training",
  cultural_awareness: "Cultural awareness", community_investment: "Community investment",
  governance: "Governance", environmental: "Environmental", partnership: "Partnership", other: "Other",
};
const statusLabel: Record<ProgressStatus, string> = {
  not_started: "Not started", on_track: "On track", delayed: "Delayed", met: "Met", missed: "Missed",
};
const claimLabel: Record<ClaimBasis, string> = {
  self_reported: "Self-reported", statutory: "Statutory", independently_verified: "Independently verified",
};
const sizeLabel: Record<string, string> = {
  lt_50: "<50", "50_249": "50–249", "250_999": "250–999", "1000_plus": "1000+", unknown: "Unknown",
};

const STATUS_BG: Record<ProgressStatus, string> = {
  not_started: "bg-ink/30", on_track: "bg-amber", delayed: "bg-amber/50", met: "bg-cedar", missed: "bg-rust",
};
const STATUS_FILL: Record<ProgressStatus, string> = {
  not_started: "rgb(var(--ink) / 0.3)", on_track: "rgb(var(--amber))", delayed: "rgb(var(--amber) / 0.5)",
  met: "rgb(var(--cedar))", missed: "rgb(var(--rust))",
};
const claimStyle: Record<ClaimBasis, string> = {
  self_reported: "border-line text-ink3", statutory: "border-cedar/50 text-cedar bg-cedar/10",
  independently_verified: "border-amber/50 text-amber bg-amber/10",
};

function SectionLead({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <h2 className="font-serif text-xl">{title}</h2>
      <p className="text-ink2 text-sm mt-0.5">{children}</p>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <section className="bg-panel rounded border border-line shadow-card p-5">{children}</section>;
}

// Hand-drawn donut (server SVG, theme-aware).
function DonutChart({ segments, total }: { segments: { label: string; value: number; color: string }[]; total: number }) {
  const size = 180, stroke = 26, r = (size - stroke) / 2, cx = size / 2, cy = size / 2, C = 2 * Math.PI * r;
  let acc = 0;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-40 h-40 shrink-0" role="img" aria-label="Status distribution">
      <g transform={`rotate(-90 ${cx} ${cy})`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgb(var(--ink) / 0.06)" strokeWidth={stroke} />
        {segments.filter((s) => s.value > 0).map((s) => {
          const frac = total ? s.value / total : 0;
          const dash = frac * C;
          const seg = (
            <circle key={s.label} cx={cx} cy={cy} r={r} fill="none" stroke={s.color} strokeWidth={stroke}
              strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-acc * C} />
          );
          acc += frac;
          return seg;
        })}
      </g>
      <text x={cx} y={cy - 2} textAnchor="middle" fontSize={32} fill="rgb(var(--ink))" style={{ fontFamily: "var(--font-display)" }}>{total}</text>
      <text x={cx} y={cy + 16} textAnchor="middle" fontSize={11} fill="rgb(var(--ink3))">commitments</text>
    </svg>
  );
}

// count + average % complete per key, sorted by count desc
function groupStat<K extends string>(keys: K[], keyOf: (i: string) => K, pctOf: (i: string) => number, ids: string[]) {
  const acc = new Map<K, { count: number; sum: number }>();
  for (const id of ids) {
    const k = keyOf(id);
    const g = acc.get(k) ?? { count: 0, sum: 0 };
    g.count += 1; g.sum += pctOf(id);
    acc.set(k, g);
  }
  return keys
    .map((k) => ({ key: k, count: acc.get(k)?.count ?? 0, avg: acc.get(k)?.count ? Math.round((acc.get(k)!.sum) / acc.get(k)!.count) : 0 }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);
}

function Breakdown({ title, rows, label }: { title: string; rows: { key: string; count: number; avg: number }[]; label: (k: string) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <Card>
      <div className="text-ink3 text-xs uppercase tracking-widest mb-3">{title}</div>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-3 text-sm">
            <div className="w-32 shrink-0 text-ink2">{label(r.key)}</div>
            <div className="h-3 flex-1 rounded bg-ink/10 overflow-hidden">
              <div className="h-full bg-amber" style={{ width: `${(r.count / max) * 100}%` }} />
            </div>
            <div className="w-6 text-right tabular-nums">{r.count}</div>
            <div className="w-12 text-right text-cedar tabular-nums">{r.avg}%</div>
          </div>
        ))}
        {rows.length === 0 && <p className="text-ink3 text-sm">No data.</p>}
      </div>
    </Card>
  );
}

export default async function CommitmentsPage() {
  // Gather every commitment via the per-sector slice (rap repo has no list-all).
  const bySectorRaw = await Promise.all(
    SECTORS.map(async (s) => ({ sector: s, commitments: await rapRepo.listCommitmentsBySector(s) })),
  );
  const all = bySectorRaw.flatMap((b) => b.commitments);
  const rollups = await Promise.all(all.map((c) => rapRepo.getRollup(c.id)));
  const rollupById = new Map(all.map((c, i) => [c.id, rollups[i]] as const));
  const orgIds = [...new Set(all.map((c) => c.orgId))];
  const orgList = await Promise.all(orgIds.map((id) => rapRepo.getOrganization(id)));
  const orgById = new Map(orgIds.map((id, i) => [id, orgList[i]] as const));

  const byId = new Map(all.map((c) => [c.id, c] as const));
  const ids = all.map((c) => c.id);
  const pct = (id: string) => rollupById.get(id)?.percentComplete ?? 0;
  const stat = (id: string): ProgressStatus => rollupById.get(id)?.latestStatus ?? "not_started";

  const n = all.length;
  const avgComplete = n ? Math.round(ids.reduce((s, id) => s + pct(id), 0) / n) : 0;
  const verified = all.filter((c) => c.provenance.claimBasis === "independently_verified").length;
  const verifiedPct = n ? Math.round((verified / n) * 100) : 0;
  const selfReported = all.filter((c) => c.provenance.claimBasis === "self_reported").length;

  const statusCounts = STATUSES.map((s) => ({ status: s, count: all.filter((c) => stat(c.id) === s).length }));
  const claimCounts = CLAIMS.map((cb) => ({ cb, count: all.filter((c) => c.provenance.claimBasis === cb).length }));

  const bySector = groupStat(SECTORS, (id) => byId.get(id)!.sector, pct, ids);
  const byType = groupStat(TYPES, (id) => byId.get(id)!.commitmentType, pct, ids);
  const sizeKeys = ["lt_50", "50_249", "250_999", "1000_plus", "unknown"];
  const bySize = groupStat(sizeKeys, (id) => orgById.get(byId.get(id)!.orgId)?.sizeBand ?? "unknown", pct, ids);

  // deadline risk: due date passed and not met/missed-resolved
  const today = new Date().toISOString().slice(0, 10);
  const overdue = all.filter((c) => c.dueDate && c.dueDate < today && stat(c.id) !== "met" && stat(c.id) !== "missed");

  // key takeaways (computed)
  const takeaways: string[] = [];
  if (n) {
    takeaways.push(`${n} commitments across ${orgIds.length} organizations, averaging ${avgComplete}% complete.`);
    if (byType[0]) takeaways.push(`${typeLabel[byType[0].key as CommitmentType]} is the most common commitment type (${byType[0].count}).`);
    takeaways.push(`${verifiedPct}% are independently verified; ${selfReported} are self-reported from the org's own RAP.`);
    if (overdue.length) takeaways.push(`${overdue.length} are past their due date and not yet met.`);
    else takeaways.push("Nothing is past its due date. On pace.");
  } else {
    takeaways.push("No commitments loaded. Run the RAP extraction pipeline to populate this view.");
  }

  return (
    <div className="space-y-8">
      <InstituteNav active="/commitments" />

      <div>
        <h1 className="font-serif text-3xl">
          The RAP Index{" "}
          <span className="text-ink3 text-base">· commitments by sector, size &amp; type</span>
        </h1>
        <p className="text-ink2 text-sm mt-1">
          Reconciliation commitments extracted from organizations&apos; published RAPs. Distinct from{" "}
          <a href="/analytics" className="text-amber hover:underline">Spend Coverage</a>, which tracks
          confirmed dollars. Click any commitment to expand it.
        </p>
      </div>

      {/* key takeaways */}
      <div>
        <SectionLead title="Key takeaways">Plain-language highlights, generated from the data below.</SectionLead>
        <Card>
          <ul className="space-y-2 text-sm">
            {takeaways.map((t, i) => (
              <li key={i} className="flex gap-2.5"><span className="text-amber mt-0.5 shrink-0">›</span><span className="text-ink2">{t}</span></li>
            ))}
          </ul>
        </Card>
      </div>

      {/* KPIs */}
      <div>
        <SectionLead title="At a glance">Headline totals for the network.</SectionLead>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card><div className="font-serif text-4xl text-amber">{n}</div><div className="text-ink3 text-sm">commitments</div></Card>
          <Card><div className="font-serif text-4xl">{orgIds.length}</div><div className="text-ink3 text-sm">organizations</div></Card>
          <Card><div className="font-serif text-4xl">{avgComplete}%</div><div className="text-ink3 text-sm">avg complete</div></Card>
          <Card><div className="font-serif text-4xl text-cedar">{verifiedPct}%</div><div className="text-ink3 text-sm">independently verified</div></Card>
        </div>
      </div>

      {/* status snapshot */}
      <div>
        <SectionLead title="Status snapshot">Where every commitment stands right now.</SectionLead>
        <Card>
          <div className="flex flex-wrap items-center gap-6">
            <DonutChart total={n} segments={statusCounts.map(({ status, count }) => ({ label: status, value: count, color: STATUS_FILL[status] }))} />
            <div className="flex-1 min-w-[200px] space-y-2">
              {statusCounts.map(({ status, count }) => {
                const p = n ? Math.round((count / n) * 100) : 0;
                return (
                  <div key={status} className={`flex items-center gap-3 text-sm ${count ? "" : "opacity-40"}`}>
                    <span className={`inline-block h-3 w-3 rounded-sm ${STATUS_BG[status]}`} />
                    <span className="flex-1">{statusLabel[status]}</span>
                    <span className="tabular-nums text-ink2">{count}</span>
                    <span className="tabular-nums text-ink3 w-10 text-right">{p}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      </div>

      {/* claim basis / verification */}
      <div>
        <SectionLead title="Verification basis">
          How each claim is backed: self-reported from the org&apos;s own RAP, statutory public data, or
          independently verified. Independent verification is the value layer.
        </SectionLead>
        <Card>
          <div className="flex items-center gap-3">
            <span className="font-serif text-3xl text-amber">{verifiedPct}%</span>
            <span className="text-ink2 text-sm">of {n} commitments are independently verified; the rest are self-reported or statutory.</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            {claimCounts.map(({ cb, count }) => (
              <span key={cb} className={`rounded-full border px-3 py-1 ${claimStyle[cb]}`}>{claimLabel[cb]} · {count}</span>
            ))}
          </div>
        </Card>
      </div>

      {/* deadline risk */}
      <div>
        <SectionLead title="Deadline risk">Commitments past their due date and not yet met.</SectionLead>
        <Card>
          {overdue.length === 0 ? (
            <p className="text-ink3 text-sm">Nothing past due. 🎉</p>
          ) : (
            <div className="divide-y divide-ink/10">
              {overdue.map((c) => (
                <div key={c.id} className="flex items-center gap-3 py-2 text-sm">
                  <span className="w-16 shrink-0 text-xs rounded border border-rust/40 bg-rust/10 text-rust px-2 py-0.5 text-center">overdue</span>
                  <div className="flex-1 min-w-0"><div className="truncate">{c.action}</div><div className="text-ink3 text-xs">{orgById.get(c.orgId)?.name} · due {c.dueDate}</div></div>
                  <span className="text-ink3 text-xs">{pct(c.id)}%</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* breakdowns */}
      <div>
        <SectionLead title="Breakdowns">Commitment counts and average completion by sector, type, and organization size.</SectionLead>
        <div className="grid lg:grid-cols-3 gap-4">
          <Breakdown title="By sector" rows={bySector} label={(k) => sectorLabel[k as Sector]} />
          <Breakdown title="By commitment type" rows={byType} label={(k) => typeLabel[k as CommitmentType]} />
          <Breakdown title="By organization size" rows={bySize} label={(k) => sizeLabel[k] ?? k} />
        </div>
      </div>

      {/* the commitments — inline-expandable */}
      <div>
        <SectionLead title="All commitments">Click a row to expand the full commitment, its source, and record progress.</SectionLead>
        <div className="space-y-2">
          {all.map((c) => {
            const st = stat(c.id);
            const p = pct(c.id);
            return (
              <details key={c.id} className="group bg-panel rounded border border-line shadow-card">
                <summary className="cursor-pointer list-none flex items-center gap-3 p-4 text-sm">
                  <span className="text-ink3 group-open:rotate-90 transition-transform shrink-0">›</span>
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{c.action}</div>
                    <div className="text-ink3 text-xs">
                      {orgById.get(c.orgId)?.name} · {sectorLabel[c.sector]} · {typeLabel[c.commitmentType]}
                      {c.dueDate ? ` · due ${c.dueDate}` : ""}
                    </div>
                  </div>
                  <span className="font-serif w-12 text-right tabular-nums">{p}%</span>
                  <span className={`text-xs rounded border px-2 py-0.5 w-24 text-center ${claimStyle[c.provenance.claimBasis]}`}>{statusLabel[st]}</span>
                </summary>

                <div className="border-t border-line px-4 py-4 space-y-3 text-sm">
                  <p className="text-ink2">
                    {c.deliverable}
                    {c.targetText ? <> · target <span className="text-ink">{c.targetText}</span></> : null}
                    {c.dueDate ? <> · due {c.dueDate}</> : null}
                  </p>

                  <div className="flex items-center gap-3">
                    <div className="h-2 flex-1 rounded bg-ink/10 overflow-hidden">
                      <div className={`h-full ${STATUS_BG[st]}`} style={{ width: `${p}%` }} />
                    </div>
                    <span className="text-xs text-ink3 w-28 text-right">{statusLabel[st]} · {p}%</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="uppercase tracking-wide text-ink3">{c.pillar}</span>
                    <span className={`rounded-full border px-2 py-0.5 ${claimStyle[c.provenance.claimBasis]}`}>{claimLabel[c.provenance.claimBasis]}</span>
                    {c.owner ? <span className="text-ink3">owner: {c.owner}</span> : null}
                  </div>

                  {c.source?.quote ? (
                    <blockquote className="border-l-2 border-line pl-3 text-ink3 text-xs italic">
                      “{c.source.quote}”{c.source.page ? <span className="not-italic"> (p.{c.source.page})</span> : null}
                    </blockquote>
                  ) : null}

                  {/* record progress (reuses the rap pipeline; self-reported until verified) */}
                  <form action={recordProgressAction} className="flex flex-wrap items-center gap-2 pt-1">
                    <input type="hidden" name="commitId" value={c.id} />
                    <select name="status" defaultValue={st} className="text-xs px-2 py-1 rounded border border-line bg-bg/40">
                      {STATUSES.map((s) => <option key={s} value={s}>{statusLabel[s]}</option>)}
                    </select>
                    <input name="observedValue" placeholder="value (optional)" className="text-xs px-2 py-1 rounded border border-line bg-bg/40 w-32" />
                    <button className="text-xs px-3 py-1 rounded border border-line hover:bg-ink/5 hover:border-amber/50">Record progress</button>
                  </form>
                </div>
              </details>
            );
          })}
          {all.length === 0 && <Card><p className="text-ink3 text-sm">No commitments yet.</p></Card>}
        </div>
      </div>

      <p className="text-ink3 text-[11px]">
        Extracted from organizations&apos; published RAPs (grounded to source quotes, human-reviewed).
        Progress is self-reported unless marked independently verified. Not Indigenous data.
      </p>
    </div>
  );
}
