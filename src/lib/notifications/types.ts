// Delivery-layer shapes for the overdue-milestone digest. The compute is reused
// from src/lib/commitments/insights.ts (computeRisk); this module only models
// the DELIVERED artifact (digest + persistence record + repo seam).
export interface DigestOrgGroup {
  orgName: string;
  overdue: number;
  atRisk: number;
  items: { title: string; targetYear: number; kind: "overdue" | "at_risk"; reason: string }[];
}

export interface OverdueDigest {
  isoWeek: string; // "2026-W30" — the idempotency key
  generatedAt: string; // ISO 8601
  year: number; // the currentYear computeRisk ran against
  totals: { overdue: number; atRisk: number; orgs: number };
  groups: DigestOrgGroup[]; // most overdue first, then most at-risk, then orgName
}

export type EmailStatus = "sent" | "failed" | "skipped"; // skipped = no recipient / no emailer

export interface NotificationRecord extends OverdueDigest {
  recipient: string | null;
  emailStatus: EmailStatus;
  emailError?: string; // present only when emailStatus === "failed"
}

export interface NotificationsRepo {
  put(rec: NotificationRecord): Promise<NotificationRecord>; // upsert by isoWeek
  latest(n: number): Promise<NotificationRecord[]>; // newest-first
  getByWeek(isoWeek: string): Promise<NotificationRecord | null>;
}
