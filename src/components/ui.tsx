import type { IdentityTier, ConfirmationStatus } from "@/lib/repo/types";

export function money(n: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(n);
}

const tierStyles: Record<IdentityTier, string> = {
  nation: "border-cedar/50 text-cedar",
  ccab: "border-amber/50 text-amber",
  self_declared: "border-rust/50 text-rust",
};
const tierLabels: Record<IdentityTier, string> = {
  nation: "Nation-verified",
  ccab: "CCAB-certified",
  self_declared: "Self-declared",
};

export function TierBadge({ tier }: { tier?: IdentityTier }) {
  if (!tier) return null;
  return (
    <span
      className={`text-[0.65rem] uppercase tracking-wider border rounded-full px-2 py-0.5 ${tierStyles[tier]}`}
    >
      {tierLabels[tier]}
    </span>
  );
}

const statusStyles: Record<ConfirmationStatus, string> = {
  confirmed: "text-cedar",
  pending: "text-ink3",
  disputed: "text-rust",
  corrected: "text-amber",
};

export function StatusBadge({ status }: { status: ConfirmationStatus }) {
  return (
    <span className={`text-xs uppercase tracking-wider ${statusStyles[status]}`}>{status}</span>
  );
}
