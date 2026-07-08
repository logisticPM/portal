// Scheduled new-case monitor (spec 2026-07-07). Detection-only: additively records
// newly-published cases as substrate and writes a scan report. No promotion/embed/
// artifact mutation — enrichment stays a reviewed human step. (Node 20 Lambda has a
// global fetch, so no polyfill is needed.)
import { scanRecent } from "../lib/cases/monitor/scan";
import { writeScan } from "../lib/cases/monitor/repo";

export const handler = async () => {
  const windowDays = Number(process.env.SCAN_WINDOW_DAYS ?? "90");
  const report = await scanRecent(windowDays);
  await writeScan(report);
  console.log(`[monitor] window ${windowDays}d · scanned ${report.scanned} · added ${report.added}`);
  return { scanned: report.scanned, added: report.added };
};
