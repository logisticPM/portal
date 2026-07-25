// Institute notifications inbox (spec 2026-07-25): the weekly overdue-milestone
// digests, newest first, with an on-demand "Generate & send now" trigger for
// the showcase demo. Institute-only (middleware + getSession guard).
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { notificationsRepo } from "@/lib/notifications";
import { InstituteNav } from "@/components/InstituteNav";
import { runDigestAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const session = getSession();
  if (session?.kind !== "indigenomics") redirect("/home");

  const digests = await notificationsRepo.latest(8);
  const latest = digests[0];

  return (
    <div className="space-y-8">
      <InstituteNav active="/notifications" />
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-amber text-xs uppercase tracking-widest mb-1">Indigenomics</div>
          <h1 className="font-serif text-3xl">Notifications</h1>
          <p className="text-ink2 text-sm mt-1">
            Weekly overdue &amp; at-risk milestone digests across the RAP Index.
            {latest ? ` Latest: ${latest.totals.overdue} overdue, ${latest.totals.atRisk} at-risk across ${latest.totals.orgs} organizations.` : " No digests yet."}
          </p>
        </div>
        <form action={runDigestAction}>
          <button type="submit" className="text-sm rounded px-4 py-2 bg-amber/10 text-amber hover:bg-amber/20 whitespace-nowrap">
            Generate &amp; send now
          </button>
        </form>
      </div>

      {digests.length === 0 ? (
        <p className="text-ink3 text-sm">No digests generated yet. Click “Generate &amp; send now” to create one.</p>
      ) : (
        <ul className="space-y-4">
          {digests.map((d) => (
            <li key={d.isoWeek} className="border border-line rounded p-4">
              <div className="flex items-center justify-between">
                <h2 className="font-serif text-lg">Week {d.isoWeek}</h2>
                <span className={`text-xs rounded px-2 py-0.5 ${d.emailStatus === "sent" ? "text-cedar border border-cedar/40 bg-cedar/10" : d.emailStatus === "failed" ? "text-rust border border-rust/40 bg-rust/10" : "text-ink3 border border-ink/15"}`}>
                  email: {d.emailStatus}
                </span>
              </div>
              <p className="text-ink2 text-sm mt-1">
                {d.totals.overdue} overdue · {d.totals.atRisk} at-risk · {d.totals.orgs} organizations · {new Date(d.generatedAt).toLocaleString()}
              </p>
              {d.groups.length > 0 && (
                <details className="mt-2">
                  <summary className="text-sm text-amber cursor-pointer">Per-organization breakdown</summary>
                  <ul className="mt-2 space-y-2">
                    {d.groups.map((g) => (
                      <li key={g.orgName} className="text-sm">
                        <span className="font-medium">{g.orgName}</span>{" "}
                        <span className="text-ink3">— {g.overdue} overdue, {g.atRisk} at-risk</span>
                        <ul className="ml-4 list-disc text-ink2">
                          {g.items.map((it, i) => (
                            <li key={i}>[{it.kind === "overdue" ? "overdue" : "at risk"}] {it.title} (target {it.targetYear}) — {it.reason}</li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
