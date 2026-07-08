import { listScans } from "@/lib/cases/monitor/repo";

export const dynamic = "force-dynamic"; // reads live scan reports from DynamoDB

export default async function MonitoringPage() {
  const scans = await listScans(20);
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-serif text-2xl">Monitoring</h1>
      <p className="mt-1 text-sm text-ink3">
        New judgments are detected automatically each week and enter as substrate;
        promotion and enrichment are a reviewed step (not automatic).
      </p>
      {scans.length === 0 && <p className="mt-4 text-sm text-ink3">No scans recorded yet.</p>}
      {scans.map((s) => (
        <section key={s.ts} className="mt-4 rounded border border-line bg-panel px-3 py-2">
          <div className="text-sm">
            <span className="font-serif">{new Date(s.ts).toLocaleDateString("en-CA")}</span>{" "}
            <span className="text-ink3">· window {s.windowDays}d · scanned {s.scanned} · </span>
            <span className="text-cedar">added {s.added}</span>
          </div>
          {s.newCitations.length > 0 && (
            <ul className="mt-1 flex flex-wrap gap-1 text-xs">
              {s.newCitations.map((c) => (
                <li key={c} className="rounded border border-line bg-ink/5 px-2 py-0.5">
                  {c} <span className="text-ink3">· pending enrichment</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
