// RAP Index dashboard (Idea 2) — server component reading the canonical store.
// Themed KPIs + commitments-by-sector/type/status are rendered by <RapCharts>
// (client, color-blind-safe palette shared with /rap/explore); the commitment
// list with its record-progress server action stays server-rendered below.
import Link from "next/link";
import { rapRepo } from "@/lib/rap";
import { recordProgressAction } from "@/lib/rap/actions";
import type { ClaimBasis, CommitmentType, Pillar, ProgressStatus, Sector } from "@/lib/rap";
import { RapCharts } from "./RapCharts";

export const dynamic = "force-dynamic";

const SECTORS: Sector[] = [
  "mining_extractive", "finance_banking", "telecom", "energy",
  "government", "retail", "transport", "other",
];
const sectorLabel: Record<Sector, string> = {
  mining_extractive: "Mining / extractive", finance_banking: "Finance / banking",
  telecom: "Telecom", energy: "Energy", government: "Government",
  retail: "Retail", transport: "Transport", other: "Other",
};
const typeLabel: Record<CommitmentType, string> = {
  procurement: "Procurement", employment: "Employment", education_training: "Education / training",
  cultural_awareness: "Cultural awareness", community_investment: "Community investment",
  governance: "Governance", environmental: "Environmental", partnership: "Partnership", other: "Other",
};
const statusLabel: Record<ProgressStatus, string> = {
  not_started: "Not started", on_track: "On track", delayed: "Delayed", met: "Met", missed: "Missed",
};
// table progress bars — ordinal brand ramp (readable; status is also labelled)
const statusColor: Record<ProgressStatus, string> = {
  not_started: "bg-ink/30", on_track: "bg-amber", delayed: "bg-amber/50", met: "bg-cedar", missed: "bg-rust",
};
const claimLabel: Record<ClaimBasis, string> = {
  self_reported: "Self-reported", statutory: "Statutory", independently_verified: "Independently verified",
};
const claimStyle: Record<ClaimBasis, string> = {
  self_reported: "border-line text-ink3", statutory: "border-cedar text-cedar", independently_verified: "border-amber text-amber",
};

export default async function RapDashboardPage() {
  // gather every commitment via the per-sector slice
  const bySector = await Promise.all(
    SECTORS.map(async (s) => ({ sector: s, commitments: await rapRepo.listCommitmentsBySector(s) })),
  );
  const all = bySector.flatMap((b) => b.commitments);
  const rollups = await Promise.all(all.map((c) => rapRepo.getRollup(c.id)));
  const rollupById = new Map(all.map((c, i) => [c.id, rollups[i]] as const));

  const orgIds = new Set(all.map((c) => c.orgId));
  const rapIds = new Set(all.map((c) => c.rapId));

  const byType = new Map<CommitmentType, number>();
  for (const c of all) byType.set(c.commitmentType, (byType.get(c.commitmentType) ?? 0) + 1);

  const byStatus = new Map<ProgressStatus, number>();
  for (const c of all) {
    const s = rollupById.get(c.id)?.latestStatus ?? "not_started";
    byStatus.set(s, (byStatus.get(s) ?? 0) + 1);
  }

  const sectorRows = bySector.filter((b) => b.commitments.length > 0);

  // serializable data for the themed client charts
  const kpis = {
    raps: rapIds.size,
    orgs: orgIds.size,
    commitments: all.length,
    sectors: sectorRows.length,
    onTrackPct: all.length
      ? Math.round(((byStatus.get("on_track") ?? 0) + (byStatus.get("met") ?? 0)) / all.length * 100)
      : 0,
  };
  const sectorData = sectorRows.map((b) => ({ key: b.sector, label: sectorLabel[b.sector], value: b.commitments.length }));
  const typeData = [...byType.entries()].map(([t, n]) => ({ key: t, label: typeLabel[t], value: n }));
  const statusData = (["met", "on_track", "delayed", "not_started", "missed"] as ProgressStatus[])
    .map((s) => ({ key: s, label: statusLabel[s], value: byStatus.get(s) ?? 0 }));

  return (
    // Full-bleed to the viewport width (matches /rap/explore); other pages keep the narrow column.
    <div className="relative left-1/2 -translate-x-1/2 w-[100vw] px-6">
      <div className="max-w-[1600px] mx-auto space-y-8">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="text-amber text-xs uppercase tracking-widest mb-1">Indigenomics · RAP Index</div>
            <h1 className="font-serif text-3xl">
              RAP commitments <span className="text-ink3 text-base">— a data view, not a rating</span>
            </h1>
            <p className="text-ink3 text-sm mt-1 max-w-3xl">
              Each commitment is badged by source: <span className="text-ink3">self-reported</span> (a voluntary RAP claim) vs <span className="text-cedar">statutory</span> / <span className="text-amber">independently verified</span> (backed by public data).
            </p>
          </div>
          <div className="flex gap-3 text-sm shrink-0">
            <Link href="/rap/explore" className="px-3 py-2 rounded bg-cedar text-white">Explore ↗</Link>
            <Link href="/rap/upload" className="px-3 py-2 rounded bg-amber text-white">Upload a RAP</Link>
            <Link href="/rap/review" className="px-3 py-2 rounded border border-line">Review queue</Link>
          </div>
        </div>

        <RapCharts kpis={kpis} bySector={sectorData} byType={typeData} byStatus={statusData} />

        <div>
          <div className="text-ink3 text-xs uppercase tracking-widest mb-3">Commitments</div>
          <div className="grid md:grid-cols-2 gap-3">
            {all.map((c) => {
              const r = rollupById.get(c.id);
              const st: ProgressStatus = r?.latestStatus ?? "not_started";
              return (
                <div key={c.id} className="bg-panel rounded border border-line p-4">
                  <div className="flex justify-between gap-4 text-sm mb-2">
                    <span className="font-medium">{c.action}</span>
                    <span className="text-ink3 whitespace-nowrap">
                      {sectorLabel[c.sector]} · {typeLabel[c.commitmentType]}
                    </span>
                  </div>
                  <div className="text-ink3 text-sm mb-2">
                    {c.deliverable}
                    {c.targetText ? <> · target <span className="text-ink">{c.targetText}</span></> : null}
                    {c.dueDate ? <> · due {c.dueDate}</> : null}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="h-2 flex-1 bg-ink/10 rounded overflow-hidden">
                      <div className={`h-full ${statusColor[st]}`} style={{ width: `${r?.percentComplete ?? 0}%` }} />
                    </div>
                    <span className="text-xs text-ink3 w-28 text-right">{statusLabel[st]} · {r?.percentComplete ?? 0}%</span>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <PillarTag pillar={c.pillar} />
                    <span className={`text-[11px] px-2 py-0.5 rounded-full border ${claimStyle[c.provenance.claimBasis]}`}>
                      {claimLabel[c.provenance.claimBasis]}
                    </span>
                  </div>
                  <form action={recordProgressAction} className="flex flex-wrap items-center gap-2 mt-3">
                    <input type="hidden" name="commitId" value={c.id} />
                    <select name="status" defaultValue="on_track" className="text-xs px-2 py-1 rounded border border-line bg-bg">
                      <option value="not_started">Not started</option>
                      <option value="on_track">On track</option>
                      <option value="delayed">Delayed</option>
                      <option value="met">Met</option>
                      <option value="missed">Missed</option>
                    </select>
                    <input name="observedValue" placeholder="value (optional)" className="text-xs px-2 py-1 rounded border border-line w-32" />
                    <button className="text-xs px-3 py-1 rounded border border-line hover:bg-ink/5">Record progress</button>
                  </form>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function PillarTag({ pillar }: { pillar: Pillar }) {
  return <span className="inline-block text-[11px] uppercase tracking-wide text-ink3">{pillar}</span>;
}
