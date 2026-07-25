// Single-table mapping for Notifications (mirrors commitments-table.ts). One
// partition holds the institute's weekly digests; SK sorts by ISO week so
// `latest(n)` is a bounded reverse Query. This is a dedicated table with only
// one entity type, so `et` is not used for routing — it is kept purely for
// informational/debugging parity with the shared-table convention.
import type { NotificationRecord } from "./types";

export const NOTIFICATIONS_TABLE = process.env.NOTIFICATIONS_TABLE ?? "Notifications";
export const NOTIFY_PK = "NOTIFY#institute";

export const notificationKeys = {
  digest: (isoWeek: string) => ({ PK: NOTIFY_PK, SK: `DIGEST#${isoWeek}` }),
};

export function toNotificationItem(rec: NotificationRecord) {
  return {
    ...notificationKeys.digest(rec.isoWeek),
    et: "Notification" as const,
    data: rec, // small; read-whole access pattern
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// Explicit field order so JSON.stringify equality holds vs the in-memory mock
// (DynamoDB does not preserve map-key order).
export function itemToNotification(it: any): NotificationRecord {
  const d = it.data as NotificationRecord;
  return {
    isoWeek: d.isoWeek,
    generatedAt: d.generatedAt,
    year: d.year,
    totals: { overdue: d.totals.overdue, atRisk: d.totals.atRisk, orgs: d.totals.orgs },
    groups: d.groups.map((g: any) => ({
      orgName: g.orgName,
      overdue: g.overdue,
      atRisk: g.atRisk,
      items: g.items.map((i: any) => ({ title: i.title, targetYear: i.targetYear, kind: i.kind, reason: i.reason })),
    })),
    recipient: d.recipient,
    emailStatus: d.emailStatus,
    ...(d.emailError !== undefined ? { emailError: d.emailError } : {}),
  };
}
