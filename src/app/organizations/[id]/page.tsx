// One organization's RAP scorecard (institute view): progress, confirmation
// integrity, maturity, deadline risk, and how it compares to its sector average.
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  commitmentsRepo,
  orgScorecard,
  computeRisk,
  confirmationIntegrity,
  getOrgProfile,
} from "@/lib/commitments";
import { orgConfirmedPct } from "@/lib/commitments/orgs";
import type { CommitmentStatus, CommitmentType, RapType } from "@/lib/commitments";
import { resolveOrgEvidence, evidenceDeps } from "@/lib/index-evidence";
import { InstituteNav } from "@/components/InstituteNav";
import { CommitmentSearch } from "@/app/commitments/CommitmentSearch";
import { FilterRow } from "@/components/FilterRow";
import { labelFor } from "@/lib/taxonomy";

// $ formatting for confirmed procurement spend — matches the cad() convention
// used elsewhere (e.g. cases/activation): whole-dollar CAD, no cents.
const cad = (n: number) =>
  new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(n);

export const dynamic = "force-dynamic";

const RAP_TYPES: RapType[] = ["reflect", "innovate", "stretch", "elevate"];
const TYPES: CommitmentType[] = [
  "employment", "procurement", "cultural_learning", "governance", "relationships", "anti_racism",
];

const STATUS_PILL: Record<CommitmentStatus, string> = {
  committed: "text-ink3 border-ink/15",
  in_progress: "text-amber border-amber/40 bg-amber/10",
  reported: "text-cedar border-cedar/40 bg-cedar/10",
  confirmed: "text-cedar border-cedar/50 bg-cedar/20",
  stalled: "text-rust border-rust/40 bg-rust/10",
};
const STATUS_BG: Record<CommitmentStatus, string> = {
  committed: "bg-ink/25",
  in_progress: "bg-amber",
  reported: "bg-cedar/45",
  confirmed: "bg-cedar",
  stalled: "bg-rust",
};

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="text-ink3 w-28 shrink-0">{label}</dt>
      <dd className="text-ink2">{value}</dd>
    </div>
  );
}

export default async function OrgScorecardPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { type?: CommitmentType; year?: string; q?: string };
}) {
  const items = await commitmentsRepo.listCommitments();
  const currentYear = new Date().getFullYear();
  const card = orgScorecard(items, params.id, currentYear);
  if (!card) notFound();
  const { commitments } = card;

  // Evidence-driven provenance: resolve once per org. For a BN-less org (the
  // common case), resolveOrgEvidence short-circuits — no confirmed-procurement
  // lookup, no opt-in check, no projected-rows read — so this org renders
  // exactly as it did before (research badges only, no self-reported group,
  // confirmedPct computed the same way rollupOrgsWithEvidence would give).
  const evidence = await resolveOrgEvidence(commitments, evidenceDeps);
  const evidenceByCommitmentId = new Map(
    evidence.filter((e) => e.tier !== "self_reported").map((e) => [e.commitmentId, e]),
  );
  const selfReportedRows = evidence.filter((e) => e.tier === "self_reported");
  const confirmableIds = new Set(commitments.filter((c) => c.type === "procurement").map((c) => c.id));
  const org = { ...card.org, confirmedPct: orgConfirmedPct(evidence, confirmableIds) };

  const integ = confirmationIntegrity(commitments);
  const risk = computeRisk(commitments, currentYear);
  const flagged = new Set(risk.flags.map((f) => f.commitment.id));
  const profile = getOrgProfile(org.orgName);

  // list filters (scoped to this org — stats above stay full)
  const base = `/organizations/${params.id}`;
  const q = (searchParams.q ?? "").trim().toLowerCase();
  const yearNum = searchParams.year ? Number(searchParams.year) : undefined;
  const filtered = commitments.filter(
    (c) =>
      (!searchParams.type || c.type === searchParams.type) &&
      (!yearNum || c.targetYear === yearNum) &&
      (!q ||
        [c.title, c.orgName, c.detail, c.targetText, c.type]
          .filter(Boolean)
          .some((s) => String(s).toLowerCase().includes(q))),
  );
  // show ALL types + all network years as filter options (unmatched → empty list)
  const typeFacets = TYPES;
  const yearFacets = Array.from({ length: 2030 - 2015 + 1 }, (_, i) => 2015 + i);
  const hasListFilter = !!(searchParams.type || searchParams.year || searchParams.q);
  const listQs = (next: { type?: string; year?: string; q?: string }) => {
    const p = new URLSearchParams();
    const type = "type" in next ? next.type : searchParams.type;
    const year = "year" in next ? next.year : searchParams.year;
    const qq = "q" in next ? next.q : searchParams.q;
    if (type) p.set("type", type);
    if (year) p.set("year", year);
    if (qq) p.set("q", qq);
    const s = p.toString();
    return s ? `${base}?${s}` : base;
  };

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
        <p className="text-ink2 text-sm mt-1">{org.sectors.map((s) => labelFor("sector", s)).join(" · ")}</p>
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
              {delta} vs {labelFor("sector", sector)})
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

      {/* commitments list — searchable / filterable, expandable rows */}
      <section className="bg-panel rounded border border-line shadow-card p-5 space-y-4">
        <div className="text-ink3 text-xs uppercase tracking-widest">Commitments</div>

        <div className="space-y-3">
          {/* search */}
          <div className="flex flex-wrap items-center gap-2">
            <CommitmentSearch basePath={base} />
            {hasListFilter && (
              <Link href={base} scroll={false} className="text-ink3 underline text-xs">clear all</Link>
            )}
          </div>

          {/* type */}
          <FilterRow label="Type">
            {typeFacets.map((t) => (
              <Link
                key={t}
                scroll={false}
                href={listQs({ type: searchParams.type === t ? undefined : t })}
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
            {yearFacets.map((y) => (
              <Link
                key={y}
                scroll={false}
                href={listQs({ year: searchParams.year === String(y) ? undefined : String(y) })}
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
          {filtered.map((c) => (
            <details key={c.id} className="group">
              <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-center gap-3 py-2 text-sm">
                <span className="text-ink3 text-xs shrink-0 transition-transform group-open:rotate-90">›</span>
                <div className="flex-1 min-w-0">
                  <div className="truncate">
                    {c.title}
                    {flagged.has(c.id) && <span className="text-rust text-xs ml-2">● at risk</span>}
                  </div>
                  <div className="text-ink3 text-xs">
                    {labelFor("commitmentType", c.type)} · target {c.targetYear}
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
                <div className="flex items-center gap-3">
                  <div className="h-2 flex-1 rounded bg-ink/10 overflow-hidden">
                    <div className={`h-full ${STATUS_BG[c.status]}`} style={{ width: `${c.progressPct}%` }} />
                  </div>
                  <span className="text-xs text-ink3 w-28 text-right">{labelFor("status", c.status)} · {c.progressPct}%</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {(() => {
                    const ev = evidenceByCommitmentId.get(c.id);
                    return ev?.tier === "confirmed" ? (
                      <span className="rounded-full border border-cedar/50 bg-cedar/20 text-cedar px-2 py-0.5">
                        Independently confirmed — {cad(ev.confirmedAmount ?? 0)} supplier-attested
                      </span>
                    ) : (
                      <span className="rounded-full border border-line text-ink3 px-2 py-0.5">Research</span>
                    );
                  })()}
                  {c.source && (
                    <a href={c.source.url} target="_blank" rel="noreferrer" className="text-amber hover:underline">
                      Source: {c.source.label} ↗
                    </a>
                  )}
                </div>
              </div>
            </details>
          ))}
          {filtered.length === 0 && <p className="text-ink3 py-2 text-sm">No commitments match.</p>}
        </div>
      </section>

      {/* opted-in self-reported RAP rows — projected from the company's uploaded
          RAP, NOT independently verified. Kept in a clearly separate, non-ranking
          group: these never appear in confirmedPct/avgProgress above (they aren't
          part of orgItems in the resolver — display-only by construction). */}
      {selfReportedRows.length > 0 && (
        <section className="bg-panel rounded border border-line shadow-card p-5 space-y-3">
          <div>
            <div className="text-ink3 text-xs uppercase tracking-widest">
              Company-reported — uploaded RAP, not independently verified
            </div>
            <p className="text-ink2 text-sm mt-1">
              This organization opted in to show progress from its uploaded RAP. These rows are
              self-reported and do not count toward the confirmed % or ranking above.
            </p>
          </div>
          <div className="divide-y divide-ink/10">
            {selfReportedRows.map((row) => (
              <div key={row.commitmentId} className="flex items-center gap-3 py-2 text-sm">
                <span className="rounded-full border border-amber/40 bg-amber/10 text-amber px-2 py-0.5 text-xs shrink-0">
                  Company-reported
                </span>
                <span className="text-ink2 flex-1 min-w-0 truncate font-mono text-xs">
                  {row.commitmentId}
                </span>
                <span
                  className={`text-xs rounded border px-2 py-0.5 w-24 text-center shrink-0 ${STATUS_PILL[row.displayStatus]}`}
                >
                  {labelFor("status", row.displayStatus)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
