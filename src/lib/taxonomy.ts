// The single source of truth for how sector / commitment-type / status / org-size
// enum values are DISPLAYED across the app. Both the commitments domain and the
// RAP-extraction domain adopt CanonicalSector + CanonicalCommitmentType; status
// and org-size are display targets that the Fact boundary crosswalks into.
export type CanonicalSector =
  | "finance" | "mining" | "energy" | "consulting" | "retail" | "health"
  | "government" | "education" | "transport" | "telecom" | "forestry"
  | "construction" | "aerospace" | "agriculture" | "media" | "other";

export type CanonicalCommitmentType =
  | "employment" | "procurement" | "cultural_learning" | "governance"
  | "relationships" | "anti_racism" | "education_training"
  | "community_investment" | "environmental" | "partnership" | "other";

export const CANONICAL_SECTORS: CanonicalSector[] = [
  "finance", "mining", "energy", "consulting", "retail", "health", "government",
  "education", "transport", "telecom", "forestry", "construction", "aerospace",
  "agriculture", "media", "other",
];

export const CANONICAL_TYPES: CanonicalCommitmentType[] = [
  "employment", "procurement", "cultural_learning", "governance", "relationships",
  "anti_racism", "education_training", "community_investment", "environmental",
  "partnership", "other",
];

export const SECTOR_LABELS: Record<CanonicalSector, string> = {
  finance: "Finance", mining: "Mining", energy: "Energy", consulting: "Consulting",
  retail: "Retail", health: "Health", government: "Government", education: "Education",
  transport: "Transport", telecom: "Telecom", forestry: "Forestry",
  construction: "Construction", aerospace: "Aerospace", agriculture: "Agriculture",
  media: "Media", other: "Other",
};

export const TYPE_LABELS: Record<CanonicalCommitmentType, string> = {
  employment: "Employment", procurement: "Procurement",
  cultural_learning: "Cultural learning", governance: "Governance",
  relationships: "Relationships", anti_racism: "Anti-racism",
  education_training: "Education & training",
  community_investment: "Community investment", environmental: "Environmental",
  partnership: "Partnership", other: "Other",
};

export const STATUS_LABELS: Record<string, string> = {
  committed: "Committed", in_progress: "In progress", reported: "Reported",
  confirmed: "Confirmed", stalled: "Stalled",
};

export const SIZE_LABELS: Record<string, string> = {
  small: "Small", medium: "Medium", large: "Large", enterprise: "Enterprise",
  unknown: "Unknown",
};

// Humanize any snake_case/lower key: "some_raw_value" -> "Some raw value".
function humanize(key: string): string {
  const s = key.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const DIM_LABELS: Record<string, Record<string, string>> = {
  sector: SECTOR_LABELS, commitmentType: TYPE_LABELS,
  status: STATUS_LABELS, sizeBand: SIZE_LABELS,
};

// The one label function every screen calls. Known dim+key -> curated label;
// anything else -> humanized fallback (never a raw snake_case leak).
export function labelFor(dim: string, key: string): string {
  return DIM_LABELS[dim]?.[key] ?? humanize(key);
}
