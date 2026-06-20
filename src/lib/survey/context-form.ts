// Pure parse + merge for the editable context slice. The server actions
// (actions.ts) are thin shells around these. Validation is light and silent:
// bad numeric/text input yields `undefined`, and applyXPatch keeps the base
// value for undefined fields (never wipes). Booleans and selects always set.
import type {
  GovernanceStructure,
  Industry,
  Organization,
  RapType,
  Rating1to5,
  SurveyResponse,
} from "./types";

// --- helpers ---------------------------------------------------------------
// A non-negative integer, or undefined when blank/invalid (→ keep base value).
function num(fd: FormData, key: string): number | undefined {
  const raw = fd.get(key);
  if (raw === null || String(raw).trim() === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.floor(n);
}

// Trimmed string, or undefined when empty (→ keep base value).
function text(fd: FormData, key: string): string | undefined {
  const v = String(fd.get(key) ?? "").trim();
  return v === "" ? undefined : v;
}

function bool(fd: FormData, key: string): boolean {
  return fd.get(key) === "true";
}

const VALID_GOVERNANCE: GovernanceStructure[] = [
  "internal_employee_group",
  "external_advisory",
  "consulted",
  "formal_evaluation",
  "none",
  "other",
];

// --- profile (Section A → Organization) ------------------------------------
export interface ProfilePatch {
  industry: Industry;
  latestRapType: RapType;
  totalEmployees: number | undefined;
  asx200: boolean;
  contactName: string | undefined;
  contactEmail: string | undefined;
}

export function parseProfileForm(fd: FormData): ProfilePatch {
  return {
    industry: String(fd.get("industry") ?? "unspecified") as Industry,
    latestRapType: String(fd.get("latestRapType") ?? "reflect") as RapType,
    totalEmployees: num(fd, "totalEmployees"),
    asx200: bool(fd, "asx200"),
    contactName: text(fd, "contactName"),
    contactEmail: text(fd, "contactEmail"),
  };
}

export function applyProfilePatch(base: Organization, patch: ProfilePatch): Organization {
  return {
    ...base,
    industry: patch.industry,
    latestRapType: patch.latestRapType,
    totalEmployees: patch.totalEmployees ?? base.totalEmployees,
    asx200: patch.asx200,
    contactName: patch.contactName ?? base.contactName,
    contactEmail: patch.contactEmail ?? base.contactEmail,
  };
}

// --- context (Sections C + D → SurveyResponse) ------------------------------
export interface ContextPatch {
  // C
  staffTotal: number | null | undefined; // null = "not collected"; undefined = keep base
  board: number | undefined;
  seniorExec: number | undefined;
  middleManagement: number | undefined;
  entryLevel: number | undefined;
  clElearning: number | undefined;
  clFaceToFace: number | undefined;
  clImmersion: number | undefined;
  hasCulturalProtocolsDoc: boolean;
  hasEmploymentStrategy: boolean;
  // D
  governanceStructures: GovernanceStructure[];
  seniorLeaderEngagement: Rating1to5 | undefined;
  partnershipsFormal: number | undefined;
  partnershipsInformal: number | undefined;
  partneredWith: string[];
}

export function parseContextForm(fd: FormData): ContextPatch {
  const notCollected = bool(fd, "staffNotCollected");
  const staffTotal = notCollected ? null : num(fd, "staffTotal");

  const governance = fd
    .getAll("governanceStructures")
    .map(String)
    .filter((g): g is GovernanceStructure => VALID_GOVERNANCE.includes(g as GovernanceStructure));

  const engagementRaw = num(fd, "seniorLeaderEngagement");
  const seniorLeaderEngagement =
    engagementRaw !== undefined && engagementRaw >= 1 && engagementRaw <= 5
      ? (engagementRaw as Rating1to5)
      : undefined;

  const partneredWith = String(fd.get("partneredWith") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    staffTotal,
    board: num(fd, "board"),
    seniorExec: num(fd, "seniorExec"),
    middleManagement: num(fd, "middleManagement"),
    entryLevel: num(fd, "entryLevel"),
    clElearning: num(fd, "clElearning"),
    clFaceToFace: num(fd, "clFaceToFace"),
    clImmersion: num(fd, "clImmersion"),
    hasCulturalProtocolsDoc: bool(fd, "hasCulturalProtocolsDoc"),
    hasEmploymentStrategy: bool(fd, "hasEmploymentStrategy"),
    governanceStructures: governance.length ? governance : ["none"],
    seniorLeaderEngagement,
    partnershipsFormal: num(fd, "partnershipsFormal"),
    partnershipsInformal: num(fd, "partnershipsInformal"),
    partneredWith,
  };
}

export function applyContextPatch(base: SurveyResponse, patch: ContextPatch): SurveyResponse {
  return {
    ...base,
    indigenousStaff: {
      ...base.indigenousStaff,
      total: patch.staffTotal === undefined ? base.indigenousStaff.total : patch.staffTotal,
    },
    indigenousStaffByLevel: {
      ...base.indigenousStaffByLevel,
      board: patch.board ?? base.indigenousStaffByLevel.board,
      seniorExec: patch.seniorExec ?? base.indigenousStaffByLevel.seniorExec,
      middleManagement: patch.middleManagement ?? base.indigenousStaffByLevel.middleManagement,
      entryLevel: patch.entryLevel ?? base.indigenousStaffByLevel.entryLevel,
    },
    culturalLearning: {
      elearning: patch.clElearning ?? base.culturalLearning.elearning,
      faceToFace: patch.clFaceToFace ?? base.culturalLearning.faceToFace,
      immersion: patch.clImmersion ?? base.culturalLearning.immersion,
    },
    hasCulturalProtocolsDoc: patch.hasCulturalProtocolsDoc,
    hasEmploymentStrategy: patch.hasEmploymentStrategy,
    governanceStructures: patch.governanceStructures,
    seniorLeaderEngagement: patch.seniorLeaderEngagement ?? base.seniorLeaderEngagement,
    partnerships: {
      formal: patch.partnershipsFormal ?? base.partnerships.formal,
      informal: patch.partnershipsInformal ?? base.partnerships.informal,
    },
    partneredWith: patch.partneredWith,
  };
}
