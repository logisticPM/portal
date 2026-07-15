import Link from "next/link";
import { casesRepo } from "@/lib/cases";
import type { Theme, CourtLevel } from "@/lib/cases";
import { SimilarCaseCard } from "../ui";
import { isAdviceSeeking } from "@/lib/cases/briefs/advice";
import { COURT_LEVELS, courtLevelLabel, THEMES, themeLabel } from "@/lib/cases/labels";

export const dynamic = "force-dynamic";

export default async function SimilarPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const narrative = String(searchParams.s ?? "").trim();
  const themes = (Array.isArray(searchParams.theme) ? searchParams.theme : searchParams.theme ? [searchParams.theme] : []) as Theme[];
  const level = (typeof searchParams.level === "string" ? searchParams.level : "") as CourtLevel | "";
  const results = narrative ? await casesRepo.findSimilarCases({ themes, level: level || undefined, narrative }) : [];
  const topWeak = results.length > 0 && results[0].breakdown.strength === "weak";
  const showAdvice = !!narrative && isAdviceSeeking(narrative);
  const sel = "rounded border border-line bg-panel px-2 py-1";

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <div className="text-amber text-xs uppercase tracking-widest mb-1">Situation → precedents</div>
        <h1 className="font-serif text-2xl">Find similar cases</h1>
        <p className="mt-1 text-sm text-ink3">
          Describe your situation to find prior cases in the same territory — a starting point
          for reading and research, <strong>not a legal match or prediction</strong>. Matches
          are within our curated core; this is legal information, not advice.
        </p>
      </div>

      <form action="/cases/similar" className="space-y-3">
        <div className="flex flex-wrap gap-3 text-sm">
          {THEMES.map((t) => (
            <label key={t} className="flex items-center gap-1">
              <input type="checkbox" name="theme" value={t} defaultChecked={themes.includes(t)} /> {themeLabel(t)}
            </label>
          ))}
        </div>
        <select name="level" defaultValue={level} className={sel} aria-label="Jurisdiction">
          <option value="">Any court</option>{COURT_LEVELS.map((l) => <option key={l} value={l}>{courtLevelLabel(l)}</option>)}
        </select>
        <textarea name="s" rows={4} required minLength={20} maxLength={1200} defaultValue={narrative}
          placeholder="Describe your situation: sector, what the government/company did, the agreement or right at issue, where…"
          className="w-full rounded border border-line bg-panel p-3 text-sm" />
        <button className="rounded bg-ink px-4 py-2 text-bg hover:bg-ink/90">Find similar cases →</button>
      </form>

      {narrative && (
        <section className="space-y-3">
          {showAdvice && (
            <p className="rounded border border-amber/40 bg-amber/10 px-3 py-2 text-sm text-ink2">
              This reads as asking about a specific situation. This provides <strong>general legal
              information, not advice</strong> — for advice, consult qualified counsel or an Indigenous legal clinic.
            </p>
          )}
          {topWeak && (
            <p className="rounded border border-line bg-amber/10 px-3 py-2 text-sm text-ink2">
              No strongly comparable case in the curated core. The following are the closest we
              found — read them with caution; a close precedent for your situation may simply not
              be in this corpus.
            </p>
          )}
          <h2 className="font-serif text-lg">Closest cases to explore</h2>
          <div className="space-y-3">
            {results.map((s) => <SimilarCaseCard key={s.case.id} scored={s} />)}
            {results.length === 0 && <p className="text-sm text-ink3">No cases to show.</p>}
          </div>
          <p className="border-t border-line pt-3 text-xs text-ink3">
            Similarity is a descriptive research aid over the curated core — matched themes,
            jurisdiction, and semantic closeness. It is not a prediction of any outcome.
          </p>
        </section>
      )}
    </div>
  );
}
