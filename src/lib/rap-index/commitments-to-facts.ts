import type { Commitment } from "@/lib/commitments";
import type { Fact } from "@/lib/rap/analytics";
import { classifyUnit } from "@/lib/rap/analytics";

// Extract the first dollar magnitude from a free-text target: "$10M" -> 10_000_000,
// "C$3B" -> 3_000_000_000, "$780K" -> 780_000, "49% equity (~$503M)" -> 503_000_000.
// Returns null when no $-amount is present — percentages, head-counts and
// qualitative targets carry no currency value and must not sum into the $ measure.
export function parseCurrencyTarget(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.match(/\$\s*([\d,]+(?:\.\d+)?)\s*([kmb])?/i);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const mult: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 };
  return n * (mult[(m[2] ?? "").toLowerCase()] ?? 1);
}

// Map a commitments-domain Commitment onto the Explore Fact shape. Sector/type
// are already canonical (verbatim). Status + org size stay the NATIVE commitments
// vocabulary (Fact.status is CommitmentStatus, Fact.sizeBand is the canonical
// org-size union). The dollar target is parsed out of the human targetText so the
// "$ committed" KPI/measure reflects real currency targets. Pillar/claimBasis/
// region/jurisdiction the commitments domain doesn't carry take honest constants
// and are hidden as degenerate dimensions in Explore.
export function commitmentsToFacts(commitments: Commitment[]): Fact[] {
  return commitments.map((c) => {
    const targetText = c.targetText ?? null;
    const targetUnit = classifyUnit(targetText);
    return {
      commitId: c.id,
      action: c.title,
      deliverable: c.detail ?? "",
      orgId: c.orgId ?? c.orgName,
      orgName: c.orgName,
      sector: c.sector,
      sizeBand: c.orgSize,
      region: "—",
      jurisdiction: "CA",
      rapId: c.id,
      rapTitle: c.title,
      pillar: "other",
      commitmentType: c.type,
      claimBasis: "self_reported",
      status: c.status,
      percentComplete: c.progressPct,
      targetText,
      targetValue: targetUnit === "currency" ? parseCurrencyTarget(targetText) : null,
      targetUnit,
      dueDate: c.targetYear ? `${c.targetYear}-12-31` : null,
      confidence: 1,
    };
  });
}
