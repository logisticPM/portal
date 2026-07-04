import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { repo } from "@/lib/repo";
import { money } from "@/components/ui";

export const dynamic = "force-dynamic";

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="bg-panel rounded border border-line shadow-card p-5">
      <div className="font-serif text-3xl text-amber">{value}</div>
      <div className="text-ink3 text-sm mt-1">{label}</div>
    </div>
  );
}

function LinkCard({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <a href={href} className="block bg-panel rounded border border-line shadow-card p-4 hover:border-amber/50">
      <div className="font-serif text-lg">{title}</div>
      <p className="text-ink3 text-sm">{desc}</p>
    </a>
  );
}

export default async function HomePage() {
  const session = getSession();
  if (!session) redirect("/");

  // Institute lands directly on the RAP Index (the commitments dashboard).
  if (session.kind === "indigenomics") redirect("/commitments");

  // ---- Company ----
  if (session.kind === "company" && session.partyId) {
    const [company, coverage] = await Promise.all([
      repo.getParty(session.partyId),
      repo.getCoverage(session.partyId),
    ]);
    return (
      <Shell eyebrow="Company portal" title={`Welcome, ${company?.name ?? "company"}`}>
        <div className="grid sm:grid-cols-3 gap-4">
          <Stat value={`${coverage.confirmedPct}%`} label="of your reported $ confirmed" />
          <Stat value={money(coverage.totalConfirmed)} label="confirmed by your suppliers" />
          <Stat value={money(coverage.totalReported)} label="reported across all lines" />
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <LinkCard href="/report" title="Report →" desc="Add itemized lines naming each supplier — your questionnaire." />
          <LinkCard href="/coverage" title="Coverage →" desc="Reported vs confirmed, by flow type." />
          <LinkCard href="/my-commitments" title="My RAP commitments →" desc="Submit & track your RAP commitments — these feed the RAP Index." />
          <LinkCard href="/cases" title="Legal cases — economic justice →" desc="3,485 Indigenous economic-justice cases, searchable & citation-anchored; activation dashboard + methodology." />
        </div>
      </Shell>
    );
  }

  // ---- Supplier ----
  if (session.kind === "supplier" && session.partyId) {
    const [supplier, record] = await Promise.all([
      repo.getParty(session.partyId),
      repo.getSupplierRecord(session.partyId),
    ]);
    return (
      <Shell eyebrow="Supplier portal" title={`Welcome, ${supplier?.name ?? "supplier"}`}>
        <div className="grid sm:grid-cols-3 gap-4">
          <Stat value={money(record.confirmedRevenue)} label="your confirmed revenue (OCAP)" />
          <Stat value={String(record.pendingCount)} label="claims awaiting your confirmation" />
          <Stat value={String(record.disputedCount)} label="disputed" />
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <LinkCard href="/confirm" title="Confirm inbox →" desc="Claims naming you, awaiting your confirm / dispute / correct." />
          <LinkCard href="/record" title="My Record →" desc="Everything claimed about you + export / withdraw." />
          <LinkCard href="/profile" title="My Profile →" desc="Your showcase + linked certifications." />
          <LinkCard href={`/s/${session.partyId}`} title="Public page →" desc="Your verified-supplier showcase (if public)." />
          <LinkCard href="/cases" title="Legal cases — economic justice →" desc="3,485 Indigenous economic-justice cases, searchable & citation-anchored; activation dashboard + methodology." />
        </div>
      </Shell>
    );
  }

  // ---- Indigenomics (institute) ----
  const [idx, pending] = await Promise.all([
    repo.getIndexSummary(),
    repo.listPendingVerifications(),
  ]);
  return (
    <Shell eyebrow="Indigenomics" title="Indigenomics dashboard">
      <div className="grid sm:grid-cols-3 gap-4">
        <Stat value={`${idx.confirmedPct}%`} label="of reported $ confirmed (network-wide)" />
        <Stat value={money(idx.totalConfirmed)} label="confirmed Indigenous economic activity" />
        <Stat value={String(pending.length)} label="certification claims pending review" />
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <LinkCard href="/rap" title="RAP Index — submitted plans →" desc="Upload RAPs (AI extraction); commitments by sector, size & type; progress over time." />
        <LinkCard href="/rap/review" title="Extraction review queue →" desc="QA flagged AI extractions before they publish." />
        <LinkCard href="/commitments" title="Commitments dashboard →" desc="RAP commitments by sector, size & type, tracked over time." />
        <LinkCard href="/analytics" title="RAP analysis →" desc="The Index: coverage, by flow, by tier, integrity signals." />
        <LinkCard href="/verify" title="Verification queue →" desc="Review pending supplier certification claims." />
        <LinkCard href="/cases" title="Legal cases — economic justice →" desc="3,485 Indigenous economic-justice cases, searchable & citation-anchored; activation dashboard + methodology." />
      </div>
    </Shell>
  );
}

function Shell({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <div>
        <div className="text-amber text-xs uppercase tracking-widest mb-1">{eyebrow}</div>
        <h1 className="font-serif text-3xl">{title}</h1>
      </div>
      {children}
    </div>
  );
}
