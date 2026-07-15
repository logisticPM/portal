import Link from "next/link";
import type { LegalCase, CaseChunk, ScoredCase } from "@/lib/cases";
import { splitHighlight } from "./highlight";
import { LENSES, lensConfig, lensHref, type Lens } from "@/lib/cases/lenses";
import { paginationWindow, pageHref } from "@/lib/cases/pagination";
import { themeLabel } from "@/lib/cases/labels";

export function TierBadge({ tier, fullTextAvailable }: { tier: "core" | "substrate"; fullTextAvailable: boolean }) {
  if (tier === "core") return <span className="rounded bg-cedar/15 px-2 py-0.5 text-xs text-cedar">core</span>;
  if (fullTextAvailable) return <span className="rounded bg-amber/15 px-2 py-0.5 text-xs text-amber">full text</span>;
  return <span className="rounded bg-ink/10 px-2 py-0.5 text-xs text-ink3">index only</span>;
}

export function CaseListItem({ c, q }: { c: LegalCase; q: string }) {
  const href = q ? `/cases/${c.id}?q=${encodeURIComponent(q)}` : `/cases/${c.id}`;
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={href} className="font-medium hover:text-amber hover:underline">{c.styleOfCause}</Link>
        <TierBadge tier={c.corpusTier} fullTextAvailable={c.fullTextAvailable} />
      </div>
      <div className="text-sm text-ink3">{c.citation} · {c.court} · {c.year}</div>
      {c.outcome.holding
        ? <div className="text-sm text-ink2">{c.outcome.holding}</div>
        : c.fullTextAvailable ? <div className="text-sm text-ink3">Full-text judgment — open to read.</div> : null}
    </li>
  );
}

export function LensSwitcher({ active, params, searching = false }: { active: Lens; params: Record<string, string | undefined>; searching?: boolean }) {
  return (
    <div className="mt-3 rounded border border-line bg-panel px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-ink3">View as</span>
        {LENSES.map((l) => (
          <a
            key={l}
            href={lensHref(params, l)}
            aria-current={l === active ? "page" : undefined}
            className={
              l === active
                ? "rounded-full bg-amber/20 px-3 py-1 text-amber"
                : "rounded-full border border-line px-3 py-1 text-ink2 hover:border-amber/50 hover:text-amber"
            }
          >
            {lensConfig(l).label}
          </a>
        ))}
      </div>
      <p className="mt-1 text-xs text-ink3">
        {lensConfig(active).tagline} <span className="text-ink3">· {searching ? "The same public record — search results are ranked by relevance; your lens sets the browse order. Anyone can switch; nothing is hidden." : "The same public record, reordered for your context — anyone can switch; nothing is hidden."}</span>
      </p>
    </div>
  );
}

export function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded border border-line bg-panel p-3 shadow-card">
      <div className="font-serif text-2xl">{value}</div>
      <div className="text-xs text-ink3">{label}</div>
    </div>
  );
}

export function Bar({ label, n, max }: { label: string; n: number; max: number }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <div className="w-40 shrink-0 text-ink2">{label}</div>
      <div className="h-4 flex-1 overflow-hidden rounded bg-ink/10">
        <div className="h-4 rounded bg-amber" style={{ width: `${max ? (n / max) * 100 : 0}%` }} />
      </div>
      <div className="w-10 text-right text-ink3">{n}</div>
    </div>
  );
}

export function ProvenanceFooter({ c }: { c: LegalCase }) {
  return (
    <footer className="mt-6 border-t border-line pt-3 text-xs text-ink3">
      {c.provenance.unofficial && "Unofficial reproduction. "}
      Source: <a href={c.provenance.sourceUrl} className="text-amber hover:underline" target="_blank" rel="noreferrer">official decision</a>. License: {c.provenance.upstreamLicense}
    </footer>
  );
}

export function FullTextReader({ chunks, q }: { chunks: CaseChunk[]; q: string }) {
  const HEAD = 12;
  const renderPara = (ch: CaseChunk, i: number) => (
    <p key={i} id={`para-${i + 1}`} className="mb-3 text-sm leading-7 text-ink2">
      <span className="mr-2 text-xs text-ink3">¶{i + 1}</span>
      {splitHighlight(ch.text, q).map((s, j) =>
        s.mark ? <mark key={j} className="bg-amber/20 text-ink">{s.text}</mark> : <span key={j}>{s.text}</span>)}
    </p>
  );
  return (
    <section className="mt-4">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-lg">Full text</h2>
        <span className="text-xs text-ink3">{chunks.length} paragraphs{q ? ` · highlighting “${q}”` : ""}</span>
      </div>
      <div className="mt-2 border-l-2 border-line pl-4">
        {chunks.slice(0, HEAD).map(renderPara)}
        {chunks.length > HEAD && (
          <details>
            <summary className="cursor-pointer text-sm text-amber">Show all {chunks.length} paragraphs</summary>
            <div className="mt-3">{chunks.slice(HEAD).map((ch, i) => renderPara(ch, i + HEAD))}</div>
          </details>
        )}
      </div>
    </section>
  );
}

export function Pagination({ page, totalPages, params }: {
  page: number; totalPages: number; params: Record<string, string | undefined>;
}) {
  if (totalPages <= 1) return null;
  const cell = "rounded border border-line px-3 py-1 text-sm";
  const link = `${cell} text-ink2 hover:border-amber/50 hover:text-amber`;
  const muted = `${cell} text-ink3/50`;
  const current = `${cell} bg-amber/20 text-amber`;
  return (
    <nav className="mt-4 flex flex-wrap items-center gap-1.5" aria-label="Pagination">
      {page > 1
        ? <Link href={pageHref(params, page - 1)} className={link}>« Prev</Link>
        : <span className={muted} aria-disabled="true">« Prev</span>}
      {paginationWindow(page, totalPages).map((p, i) =>
        p === "ellipsis"
          ? <span key={`e${i}`} className="px-1 text-ink3">…</span>
          : p === page
            ? <span key={p} aria-current="page" className={current}>{p}</span>
            : <Link key={p} href={pageHref(params, p)} className={link}>{p}</Link>)}
      {page < totalPages
        ? <Link href={pageHref(params, page + 1)} className={link}>Next »</Link>
        : <span className={muted} aria-disabled="true">Next »</span>}
    </nav>
  );
}

export function SimilarCaseCard({ scored }: { scored: ScoredCase }) {
  const { case: c, breakdown: b } = scored;
  const chip =
    b.strength === "strong" ? "bg-cedar/15 text-cedar"
    : b.strength === "moderate" ? "bg-amber/15 text-amber"
    : "bg-ink/10 text-ink3";
  const closestOn = [
    ...b.matchedThemes.map(themeLabel),
    b.sameJurisdiction ? c.court : null,
  ].filter(Boolean).join(" · ");
  return (
    <div className="rounded border border-line bg-panel p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/cases/${c.id}`} className="font-serif hover:text-amber hover:underline">
          {c.styleOfCause} ({c.court}, {c.year})
        </Link>
        <span className={`rounded px-2 py-0.5 text-xs ${chip}`}>{b.strength} match</span>
        <TierBadge tier={c.corpusTier} fullTextAvailable={c.fullTextAvailable} />
      </div>
      {closestOn && <div className="mt-1 text-xs text-ink3">Closest on: {closestOn}</div>}
      {c.outcome.holding && <p className="mt-1 text-sm text-ink2">What it established: {c.outcome.holding}</p>}
    </div>
  );
}
