// One organization's RAP scorecard (institute view): progress, confirmation
// integrity, maturity, deadline risk, and how it compares to its sector average.
import { notFound } from "next/navigation";
import {
  commitmentsRepo,
  orgScorecard,
  computeRisk,
  confirmationIntegrity,
  getOrgProfile,
} from "@/lib/commitments";
import type { CommitmentStatus, RapType } from "@/lib/commitments";
import { InstituteNav } from "@/components/InstituteNav";

export const dynamic = "force-dynamic";

const label = (s: string) => s.replace(/_/g, " ");
const RAP_TYPES: RapType[] = ["reflect", "innovate", "stretch", "elevate"];

const STATUS_PILL: Record<CommitmentStatus, string> = {
  committed: "text-ink3 border-ink/15",
  in_progress: "text-amber border-amber/40 bg-amber/10",
  reported: "text-cedar border-cedar/40 bg-cedar/10",
  confirmed: "text-cedar border-cedar/50 bg-cedar/20",
  stalled: "text-rust border-rust/40 bg-rust/10",
};

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="text-ink3 w-28 shrink-0">{label}</dt>
      <dd className="text-ink2">{value}</dd>
    </div>
  );
}

export default async function OrgScorecardPage({ params }: { params: { id: string } }) {
  const items = await commitmentsRepo.listCommitments();
  const currentYear = new Date().getFullYear();
  const card = orgScorecard(items, params.id, currentYear);
  if (!card) notFound();
  const { org, commitments } = card;

  const integ = confirmationIntegrity(commitments);
  const risk = computeRisk(commitments, currentYear);
  const flagged = new Set(risk.flags.map((f) => f.commitment.id));
  const profile = getOrgProfile(org.orgName);

  // benchmark vs the org's primary sector (across the whole network)
  const sector = org.sectors[0];
  const sectorItems = items.filter((c) => c.sector === sector);
  const sectorAvg = sectorItems.length
    ? Math.round(sectorItems.reduce((s, c) => s + c.progressPct, 0) / sectorItems.length)
    : 0;
  const delta = org.avgProgress - sectorAvg;

  // maturity mix for this org
  const tierCounts = RAP_TYPES.map((r) => ({
    r,
    n: commitments.filter((c) => c.rapType === r).length,
  }));

  return (
    <div className="space-y-8">
      <InstituteNav active="/organizations" />

      <div>
        <a href="/organizations" className="text-sm text-ink3 hover:text-amber hover:underline">
          ← all organizations
        </a>
        <h1 className="mt-2 font-serif text-3xl">{org.orgName}</h1>
        <p className="text-ink2 text-sm mt-1 capitalize">{org.sectors.map(label).join(" · ")}</p>
      </div>

      {/* about — public reference info (Wikipedia-style) */}
      {profile && (
        <section className="bg-panel rounded border border-line shadow-card p-5">
          <div className="text-ink3 text-xs uppercase tracking-widest mb-3">About</div>
          <p className="text-ink2 text-sm mb-4">{profile.about}</p>
          <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-2 text-sm">
            {profile.legalName && <InfoRow label="Legal name" value={profile.legalName} />}
            <InfoRow label="Headquarters" value={profile.headquarters} />
            <InfoRow label="Founded" value={profile.founded} />
            <InfoRow label="Industry" value={profile.industry} />
            {profile.employees && <InfoRow label="Employees" value={profile.employees} />}
            {profile.ticker && <InfoRow label="Listing" value={profile.ticker} />}
          </dl>
          <a
            href={profile.website}
            target="_blank"
            rel="noreferrer"
            className="text-amber hover:underline text-sm mt-3 inline-block"
          >
            {profile.website.replace(/^https?:\/\//, "")} ↗
          </a>
          <p className="text-ink3 text-[11px] mt-2">Public reference information.</p>
        </section>
      )}

      {/* stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-panel rounded border border-line shadow-card p-5">
          <div className="font-serif text-4xl text-amber">{org.total}</div>
          <div className="text-ink3 text-sm">commitments</div>
        </div>
        <div className="bg-panel rounded border border-line shadow-card p-5">
          <div className="font-serif text-4xl">{org.avgProgress}%</div>
          <div className="text-ink3 text-sm">
            avg progress{" "}
            <span className={delta >= 0 ? "text-cedar" : "text-rust"}>
              ({delta >= 0 ? "+" : ""}
              {delta} vs {label(sector)})
            </span>
          </div>
        </div>
        <div className="bg-panel rounded border border-line shadow-card p-5">
          <div className="font-serif text-4xl text-cedar">{org.confirmedPct}%</div>
          <div className="text-ink3 text-sm">confirmed</div>
        </div>
        <div className="bg-panel rounded border border-line shadow-card p-5">
          <div className="font-serif text-4xl text-rust">{org.overdueCount + org.atRiskCount}</div>
          <div className="text-ink3 text-sm">
            {org.overdueCount} overdue · {org.atRiskCount} at risk
          </div>
        </div>
      </div>

      {/* confirmation integrity */}
      <section className="bg-panel rounded border border-line shadow-card p-5">
        <div className="text-ink3 text-xs uppercase tracking-widest mb-3">Confirmation integrity</div>
        {integ.claimed === 0 ? (
          <p className="text-ink3 text-sm">No reported or confirmed outcomes yet.</p>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <span className="font-serif text-3xl text-cedar">{integ.confirmationRate}%</span>
              <span className="text-ink2 text-sm">
                of {integ.claimed} claimed outcomes are supplier-confirmed
              </span>
            </div>
            <div className="mt-3 h-3 rounded bg-ink/10 overflow-hidden flex">
              <div className="h-full bg-cedar" style={{ width: `${(integ.confirmed / integ.claimed) * 100}%` }} title={`Confirmed: ${integ.confirmed}`} />
              <div className="h-full bg-amber/50" style={{ width: `${(integ.selfReported / integ.claimed) * 100}%` }} title={`Self-reported: ${integ.selfReported}`} />
            </div>
            <div className="mt-2 flex gap-4 text-xs text-ink3">
              <span><span className="inline-block h-2.5 w-2.5 rounded-sm bg-cedar mr-1" />{integ.confirmed} confirmed</span>
              <span><span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber/50 mr-1" />{integ.selfReported} self-reported (unverified)</span>
            </div>
          </>
        )}
      </section>

      {/* maturity mix (only when the data actually has RAP tiers) */}
      {tierCounts.some((t) => t.n > 0) && (
        <section className="bg-panel rounded border border-line shadow-card p-5">
          <div className="text-ink3 text-xs uppercase tracking-widest mb-3">RAP maturity mix</div>
          <div className="flex flex-wrap gap-2 text-sm">
            {tierCounts.map(({ r, n }) => (
              <span
                key={r}
                className={`rounded-full border px-3 py-1 capitalize ${
                  n ? "border-amber/40 text-amber bg-amber/10" : "border-line text-ink3 opacity-50"
                }`}
              >
                {r} · {n}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* commitments list */}
      <section className="bg-panel rounded border border-line shadow-card p-5">
        <div className="text-ink3 text-xs uppercase tracking-widest mb-3">Commitments</div>
        <div className="divide-y divide-ink/10">
          {commitments.map((c) => (
            <div key={c.id} className="flex items-center gap-3 py-2 text-sm">
              <div className="flex-1 min-w-0">
                <div className="truncate">
                  {c.title}
                  {flagged.has(c.id) && <span className="text-rust text-xs ml-2">● at risk</span>}
                </div>
                <div className="text-ink3 text-xs capitalize">
                  {label(c.sector)} · {label(c.type)} · {c.rapType ?? "—"} · target {c.targetYear}
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
        </div>
      </section>
    </div>
  );
}
