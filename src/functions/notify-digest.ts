// Weekly digest cron entry (spec 2026-07-25). Thin: all logic is in runDigest,
// which is unit-tested. REPO_IMPL/NOTIFICATIONS_TABLE/DIGEST_* come from the
// cron env in sst.config.ts. Mirrors src/functions/case-monitor.handler.
import { runDigest } from "../lib/notifications/run";

export async function handler(): Promise<void> {
  const rec = await runDigest();
  // counts/status only — NEVER log the record body or recipient (PII).
  console.log(`[notify-digest] week=${rec.isoWeek} overdue=${rec.totals.overdue} atRisk=${rec.totals.atRisk} email=${rec.emailStatus}`);
}
