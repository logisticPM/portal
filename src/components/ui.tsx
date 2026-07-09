import type { ConfirmationStatus, Party, FlowType, FlowTag } from "@/lib/repo/types";
import { TIER_LABELS, TIER_STYLES } from "@/lib/repo/labels";

export function money(n: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(n);
}

// Only suppliers carry a tier — pass the whole party and let the badge narrow by role.
export function TierBadge({ party }: { party?: Party | null }) {
  if (!party || party.role !== "supplier") return null;
  const tier = party.identityTier;
  return (
    <span
      className={`text-[0.65rem] uppercase tracking-wider border rounded-full px-2 py-0.5 ${TIER_STYLES[tier]}`}
    >
      {TIER_LABELS[tier]}
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

// A line's flow type. procurement = buy FROM; capital = invest INTO. (Equity is the supplier's
// ownership certification — their tier, not a flow. Innovation is a TAG — see TagChip.)
const flowStyles: Record<FlowType, string> = {
  procurement: "border-amber/40 text-amber",
  capital: "border-cedar/40 text-cedar",
};

export function FlowBadge({ flowType }: { flowType: FlowType }) {
  return (
    <span
      className={`text-[0.65rem] uppercase tracking-wider border rounded px-1.5 py-0.5 ${flowStyles[flowType]}`}
    >
      {flowType}
    </span>
  );
}

// A tag categorises a flow without being one (e.g. an innovation / R&D procurement line).
export function TagChip({ tag }: { tag: FlowTag }) {
  return (
    <span className="text-[0.6rem] uppercase tracking-wider border border-ink3/40 text-ink3 rounded px-1.5 py-0.5">
      {tag}
    </span>
  );
}

// Flow-aware phrasing for the confirm inbox, so a capital line doesn't read as "paid you".
export function flowClaim(flowType: FlowType): string {
  switch (flowType) {
    case "procurement":
      return "says they paid you";
    case "capital":
      return "reports an equity investment into you of";
  }
}
