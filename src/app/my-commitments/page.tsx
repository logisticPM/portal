// Company self-service: manage your own RAP commitments. These feed the RAP Index
// (institute view). Company-only (middleware). Status is capped at "reported" —
// supplier/Nation confirmation is the portal's layer, not self-serve.
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { repo } from "@/lib/repo";
import { commitmentsRepo } from "@/lib/commitments";
import type { CommitmentStatus, CommitmentType, OrgSize, Sector } from "@/lib/commitments";
import {
  createCommitmentAction,
  updateCommitmentAction,
  deleteCommitmentAction,
} from "@/lib/commitments/actions";

export const dynamic = "force-dynamic";

const SECTORS: Sector[] = [
  "finance", "mining", "energy", "consulting", "retail",
  "health", "government", "education", "transport",
];
const TYPES: CommitmentType[] = [
  "employment", "procurement", "cultural_learning", "governance", "relationships", "anti_racism",
];
const SIZES: OrgSize[] = ["small", "medium", "large", "enterprise"];
const STATUSES: CommitmentStatus[] = ["committed", "in_progress", "reported", "stalled"];
const label = (s: string) => s.replace(/_/g, " ");

const STATUS_PILL: Record<string, string> = {
  committed: "text-ink3 border-ink/15",
  in_progress: "text-amber border-amber/40 bg-amber/10",
  reported: "text-cedar border-cedar/40 bg-cedar/10",
  stalled: "text-rust border-rust/40 bg-rust/10",
};

export default async function MyCommitmentsPage() {
  const session = getSession();
  if (session?.kind !== "company" || !session.partyId) redirect("/home");
  const [party, mine] = await Promise.all([
    repo.getParty(session.partyId),
    commitmentsRepo.listCommitments({ orgId: session.partyId }),
  ]);
  const year = new Date().getFullYear();

  return (
    <div className="space-y-8">
      <div>
        <div className="text-amber text-xs uppercase tracking-widest mb-1">Company portal</div>
        <h1 className="font-serif text-3xl">My RAP commitments</h1>
        <p className="text-ink2 text-sm mt-1">
          {party?.name ?? "Your organization"} — these feed the network{" "}
          <a href="/commitments" className="text-amber hover:underline">RAP Index</a>. Report your own
          progress; confirmation by suppliers/Nations is handled separately.
        </p>
      </div>

      {/* add form */}
      <section className="bg-panel rounded border border-line shadow-card p-5">
        <div className="text-ink3 text-xs uppercase tracking-widest mb-3">Add a commitment</div>
        <form action={createCommitmentAction} className="grid gap-3 sm:grid-cols-2">
          <label className="sm:col-span-2 text-sm">
            <span className="text-ink2">Commitment</span>
            <input
              name="title" required placeholder="e.g. 5% Indigenous procurement by 2027"
              className="mt-1 w-full rounded border border-line bg-bg/40 px-3 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="text-ink2">Sector</span>
            <select name="sector" className="mt-1 w-full rounded border border-line bg-bg/40 px-3 py-2 capitalize">
              {SECTORS.map((s) => <option key={s} value={s}>{label(s)}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-ink2">Commitment type</span>
            <select name="type" className="mt-1 w-full rounded border border-line bg-bg/40 px-3 py-2 capitalize">
              {TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-ink2">Organization size</span>
            <select name="orgSize" className="mt-1 w-full rounded border border-line bg-bg/40 px-3 py-2 capitalize">
              {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-ink2">Target year</span>
            <input
              name="targetYear" type="number" min={year} max={year + 10} defaultValue={year + 1}
              className="mt-1 w-full rounded border border-line bg-bg/40 px-3 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="text-ink2">Status</span>
            <select name="status" defaultValue="committed" className="mt-1 w-full rounded border border-line bg-bg/40 px-3 py-2 capitalize">
              {STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-ink2">Progress %</span>
            <input
              name="progressPct" type="number" min={0} max={100} defaultValue={0}
              className="mt-1 w-full rounded border border-line bg-bg/40 px-3 py-2"
            />
          </label>
          <div className="sm:col-span-2">
            <button className="rounded bg-ink px-4 py-2 text-bg hover:bg-ink/90">Add commitment</button>
          </div>
        </form>
      </section>

      {/* existing */}
      <section className="bg-panel rounded border border-line shadow-card p-5">
        <div className="text-ink3 text-xs uppercase tracking-widest mb-3">
          Your commitments ({mine.length})
        </div>
        {mine.length === 0 ? (
          <p className="text-ink3 text-sm">None yet — add your first above.</p>
        ) : (
          <div className="divide-y divide-ink/10">
            {mine.map((c) => (
              <div key={c.id} className="py-3 flex flex-wrap items-center gap-3 text-sm">
                <div className="flex-1 min-w-[220px]">
                  <div>{c.title}</div>
                  <div className="text-ink3 text-xs capitalize">
                    {label(c.sector)} · {label(c.type)} · {c.orgSize} · target {c.targetYear}
                  </div>
                </div>
                {/* inline update */}
                <form action={updateCommitmentAction} className="flex items-center gap-2">
                  <input type="hidden" name="id" value={c.id} />
                  <select name="status" defaultValue={c.status} className="rounded border border-line bg-bg/40 px-2 py-1 text-xs capitalize">
                    {STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
                  </select>
                  <input
                    name="progressPct" type="number" min={0} max={100} defaultValue={c.progressPct}
                    className="w-16 rounded border border-line bg-bg/40 px-2 py-1 text-xs"
                  />
                  <button className="rounded border border-line px-2 py-1 text-xs hover:border-amber/50 text-ink2 hover:text-ink">Save</button>
                </form>
                <span className={`text-xs rounded border px-2 py-0.5 capitalize ${STATUS_PILL[c.status] ?? "border-line"}`}>
                  {label(c.status)}
                </span>
                <form action={deleteCommitmentAction}>
                  <input type="hidden" name="id" value={c.id} />
                  <button className="text-rust text-xs hover:underline">delete</button>
                </form>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
