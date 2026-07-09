// Analysis layer over commitments: deadline risk + an auto-generated narrative.
// Pure functions, parameterized by `currentYear` (kept out of buildSummary so the
// golden mock≡dynamo summary stays time-independent). The dashboard calls these.
import type { Commitment, CommitmentSummary } from "./types";
import { labelFor } from "@/lib/taxonomy";

// RapType (reflect/innovate/stretch/elevate) is out of taxonomy scope — keep a
// tiny local capitalizer for it.
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export interface Integrity {
  confirmed: number; // supplier-confirmed outcomes
  selfReported: number; // reported by the org but not yet confirmed
  claimed: number; // confirmed + selfReported
  confirmationRate: number; // confirmed / claimed, %
}

// The report→confirm lens on commitments: of the outcomes an org has *claimed*
// (reported or confirmed), what share is actually supplier-confirmed.
export function confirmationIntegrity(items: Commitment[]): Integrity {
  const confirmed = items.filter((c) => c.status === "confirmed").length;
  const selfReported = items.filter((c) => c.status === "reported").length;
  const claimed = confirmed + selfReported;
  return {
    confirmed,
    selfReported,
    claimed,
    confirmationRate: claimed ? Math.round((confirmed / claimed) * 100) : 0,
  };
}

export interface RiskFlag {
  commitment: Commitment;
  kind: "overdue" | "at_risk";
  reason: string;
}

export interface RiskReport {
  flags: RiskFlag[];
  overdueCount: number;
  atRiskCount: number;
  onTrackCount: number; // confirmed or on-pace (i.e. not flagged)
}

// Overdue = target year passed and not supplier-confirmed. At-risk = due this year
// but behind pace (<60%) or stalled. Only `confirmed` (independently verified) is
// ever trusted as "done" — a self-reported but unconfirmed milestone past its
// deadline is exactly the confirmation gap this dashboard exists to surface.
export function computeRisk(items: Commitment[], currentYear: number): RiskReport {
  const flags: RiskFlag[] = [];
  for (const c of items) {
    // confirmed = supplier/Nation-verified delivery — the only status we trust as
    // done. Everything else (committed / in_progress / stalled / self-reported) is
    // still subject to the deadline check.
    if (c.status === "confirmed") continue;
    const notes =
      (c.status === "stalled" ? " · stalled" : "") +
      (c.status === "reported" ? " · self-reported, unconfirmed" : "");
    if (c.targetYear < currentYear) {
      flags.push({
        commitment: c,
        kind: "overdue",
        reason: `Target ${c.targetYear} passed · ${c.progressPct}%${notes}`,
      });
    } else if (c.targetYear === currentYear && (c.progressPct < 60 || c.status === "stalled")) {
      flags.push({
        commitment: c,
        kind: "at_risk",
        reason: `Due ${c.targetYear} · ${c.progressPct}%${notes}`,
      });
    }
  }
  const rank = { overdue: 0, at_risk: 1 };
  flags.sort(
    (a, b) =>
      rank[a.kind] - rank[b.kind] ||
      a.commitment.progressPct - b.commitment.progressPct ||
      a.commitment.id.localeCompare(b.commitment.id),
  );
  const overdueCount = flags.filter((f) => f.kind === "overdue").length;
  const atRiskCount = flags.length - overdueCount;
  return { flags, overdueCount, atRiskCount, onTrackCount: items.length - flags.length };
}

// A few plain-language takeaways generated deterministically from the numbers.
export function buildInsights(
  summary: CommitmentSummary,
  items: Commitment[],
  currentYear: number,
): string[] {
  if (summary.total === 0) return ["No commitments match the current filter."];
  const out: string[] = [];

  out.push(
    `${summary.total} commitments across ${summary.orgCount} organizations, averaging ${summary.avgProgress}% progress. ${summary.confirmedPct}% already confirmed.`,
  );

  const types = Object.entries(summary.byType).filter(([, g]) => g.count > 0);
  if (types.length) {
    const most = types.reduce((a, b) => (b[1].count > a[1].count ? b : a));
    const weakest = types.reduce((a, b) => (b[1].avgProgress < a[1].avgProgress ? b : a));
    out.push(
      `${labelFor("commitmentType", most[0])} is the most common commitment type (${most[1].count}), while ${labelFor("commitmentType", weakest[0])} lags on delivery at ${weakest[1].avgProgress}% average progress.`,
    );
  }

  const tiers = Object.entries(summary.byRapType).filter(([, g]) => g.count > 0);
  if (tiers.length >= 2) {
    const best = tiers.reduce((a, b) => (b[1].avgProgress > a[1].avgProgress ? b : a));
    const worst = tiers.reduce((a, b) => (b[1].avgProgress < a[1].avgProgress ? b : a));
    if (best[0] !== worst[0]) {
      out.push(
        `${cap(best[0])}-tier RAPs average ${best[1].avgProgress}% progress vs ${worst[1].avgProgress}% for ${worst[0]}-tier. Maturity tracks with delivery.`,
      );
    }
  }

  const integ = confirmationIntegrity(items);
  if (integ.claimed) {
    out.push(
      `Of ${integ.claimed} claimed outcomes, ${integ.confirmationRate}% are supplier-confirmed. ${integ.selfReported} remain self-reported and unverified.`,
    );
  }

  const risk = computeRisk(items, currentYear);
  if (risk.overdueCount || risk.atRiskCount) {
    const parts: string[] = [];
    if (risk.overdueCount) parts.push(`${risk.overdueCount} are past their target year without confirmation`);
    if (risk.atRiskCount) parts.push(`${risk.atRiskCount} due in ${currentYear} are behind pace`);
    out.push(`Needs attention: ${parts.join(", and ")}.`);
  } else {
    out.push("No overdue or at-risk commitments. The network is on pace.");
  }

  return out;
}
