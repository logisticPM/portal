import type { IdentityTier, ConfirmationStatus, Party } from "@/lib/repo/types";

export function money(n: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(n);
}

const tierStyles: Record<IdentityTier, string> = {
  nation: "border-cedar/30 bg-cedar/10 text-cedar",
  ccab: "border-amber/30 bg-amber/10 text-amber",
  self_declared: "border-rust/30 bg-rust/10 text-rust",
};
const tierLabels: Record<IdentityTier, string> = {
  nation: "Nation-verified",
  ccab: "CCAB-certified",
  self_declared: "Self-declared",
};

// Only suppliers carry a tier — pass the whole party and let the badge narrow by role.
export function TierBadge({ party }: { party?: Party | null }) {
  if (!party || party.role !== "supplier") return null;
  const tier = party.identityTier;
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
