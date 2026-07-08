import Link from "next/link";
import { getSession } from "@/lib/auth";
import { listRecentBriefs } from "@/lib/cases/briefs/repo";
import { requestBriefing } from "./actions";

export const dynamic = "force-dynamic";

export default async function BriefingsPage({ searchParams }: { searchParams?: { err?: string } }) {
  const session = getSession();
  const recent = await listRecentBriefs(20);
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <div className="text-amber text-xs uppercase tracking-widest mb-1">Precedent → policy</div>
        <h1 className="font-serif text-3xl">Briefing notes</h1>
        <p className="mt-1 text-sm text-ink3">
          Ask a policy or business question; get a structured note grounded in the curated case
          library. Generates in ~30–60 seconds. <strong>AI-generated · not legal advice.</strong>
        </p>
      </div>
      {searchParams?.err === "quota" && (
        <p className="rounded border border-line bg-amber/10 px-3 py-2 text-sm text-ink2">Daily briefing limit reached — please try again tomorrow.</p>
      )}
      {searchParams?.err === "length" && (
        <p className="rounded border border-line bg-amber/10 px-3 py-2 text-sm text-ink2">Please ask a question between 10 and 500 characters.</p>
      )}
      {session ? (
        <form action={requestBriefing} className="space-y-2">
          <textarea name="question" rows={3} required minLength={10} maxLength={500}
            placeholder="e.g. What obligations does a mining company have before operating on treaty land?"
            className="w-full rounded border border-line bg-panel p-3 text-sm" />
          <button className="rounded bg-ink px-4 py-2 text-bg hover:bg-ink/90">Generate briefing →</button>
        </form>
      ) : (
        <p className="text-sm text-ink3">Sign in to generate a briefing (browsing stays open).{" "}
          <Link href="/login" className="text-amber hover:underline">Log in →</Link></p>
      )}
      <section>
        <h2 className="font-serif text-lg">Recent briefings</h2>
        <ul className="mt-2 space-y-1 text-sm text-ink2">
          {recent.map((b) => (
            <li key={b.id}>
              <Link href={`/cases/briefings/${b.id}`} className="hover:text-amber hover:underline">{b.question}</Link>{" "}
              <span className="text-xs text-ink3">· {b.status} · {b.createdAt.slice(0, 10)}</span>
            </li>
          ))}
          {recent.length === 0 && <li className="text-ink3">None yet — ask the first question.</li>}
        </ul>
      </section>
    </div>
  );
}
