import type { IdentityTier, ConfirmationStatus, Party, Pillar } from "@/lib/repo/types";

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

// A line's pillar is its economic flow category. Procurement is the MVP flagship;
// equity is the high-value second (JV / ownership — the phantom-JV fraud target).
const pillarStyles: Record<Pillar, string> = {
  procurement: "border-amber/40 text-amber",
  equity: "border-cedar/40 text-cedar",
  capital: "border-ink3/40 text-ink2",
  innovation: "border-ink3/40 text-ink2",
};

export function PillarBadge({ pillar }: { pillar: Pillar }) {
  return (
    <span
      className={`text-[0.65rem] uppercase tracking-wider border rounded px-1.5 py-0.5 ${pillarStyles[pillar]}`}
    >
      {pillar}
    </span>
  );
}

// Pillar-aware phrasing for the confirm inbox, so an equity claim doesn't read as "paid you".
export function pillarClaim(pillar: Pillar): string {
  switch (pillar) {
    case "procurement":
      return "says they paid you";
    case "equity":
      return "reports an equity stake with you of";
    case "capital":
      return "reports capital deployed with you of";
    case "innovation":
      return "reports an innovation contract with you worth";
  }
}
