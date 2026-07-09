// Single source of truth for the ownership-certification tier's display labels,
// badge styles, and sort rank. Replaces the copies that were duplicated across
// the supplier pages, the analytics/report pages, and the ui TierBadge.
import type { IdentityTier } from "./types";

export const TIER_LABELS: Record<IdentityTier, string> = {
  nation: "Nation-verified",
  ccib: "CCIB-certified",
  self_declared: "Self-declared",
};

export const TIER_STYLES: Record<IdentityTier, string> = {
  nation: "border-cedar/30 bg-cedar/10 text-cedar",
  ccib: "border-amber/30 bg-amber/10 text-amber",
  self_declared: "border-rust/30 bg-rust/10 text-rust",
};

export const TIER_RANK: Record<IdentityTier, number> = { nation: 0, ccib: 1, self_declared: 2 };
