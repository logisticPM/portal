// Testable server-action "cores" — plain async functions with dependencies
// injected as arguments, no "use server" directive. actions.ts (which has a
// file-level "use server" and therefore turns every export into a Next.js
// Server Action) wraps these in thin FormData-parsing shims that provide the
// real dependencies (e.g. getRegistryProvider()). Server Actions can't accept
// non-serializable arguments like a RegistryProvider instance, so the
// resolvable, unit-testable logic lives here instead.
import { extractionRepo, rapRepo } from "./index";
import { isValidBN } from "./bn";
import type { RegistryProvider } from "./registry";
import type { ProgressStatus } from "./types";
import { computeRollup } from "./rollup";
import type { Session } from "@/lib/auth";

// Guards against an out-of-union status reaching the store: recordRapProgressForParty
// is a Next.js Server Action and therefore directly POST-able, bypassing whatever
// <select> the UI eventually offers. An invalid status would make
// STATUS_PERCENT[latest.status] (src/lib/rap/rollup.ts) undefined and corrupt the
// append-only (unrecoverable) rollup row the dashboard + Task 6's publish lock read.
const VALID_STATUS = new Set<ProgressStatus>(["not_started", "on_track", "delayed", "met", "missed"]);

// Review-time BN resolution: validate the BN, verify it against the registry,
// and persist the result on the job. Never silently self-asserts — an unknown
// BN is an error unless the caller explicitly sets `selfAsserted`.
export async function resolveOrgForJob(
  reg: RegistryProvider,
  input: { jobId: string; bnRaw: string; selfAsserted?: boolean },
): Promise<{ ok: true; legalName: string | null } | { ok: false; error: string }> {
  const v = isValidBN(input.bnRaw);
  if (!v) return { ok: false, error: "Invalid Business Number" };
  const entity = await reg.verifyBN(v.bn9);
  if (entity) {
    await extractionRepo.setJobOrg(input.jobId, { businessNumber: v.bn9, businessNumberSource: "ised", registryLegalName: entity.legalName, registryStatus: entity.status });
    return { ok: true, legalName: entity.legalName };
  }
  if (input.selfAsserted) {
    await extractionRepo.setJobOrg(input.jobId, { businessNumber: v.bn9, businessNumberSource: "self_asserted", registryLegalName: null, registryStatus: null });
    return { ok: true, legalName: null };
  }
  return { ok: false, error: "BN not found in the federal registry. Mark self-asserted to proceed." };
}

// Publish gate: a job can only be published once its org identity (Business
// Number) has been resolved — either verified against the registry or
// explicitly self-asserted by a reviewer. Pure/sync so it can be called from
// both the Server Action (actions.ts) and unit tests without an async wrapper.
export function canPublish(job: { businessNumber: string | null }): boolean {
  return job.businessNumber != null;
}

// Upload-time BN auto-tag: a company uploading its own RAP should have the
// created job tagged with its claimed BN so it doesn't get re-resolved at
// review (staff uploads leave the BN null, resolved at review as before). A
// granted OrgClaim is always ISED-verified — claimOrgForParty only grants
// after verifyBN succeeds — so the source is always "ised". Ambiguous (more
// than one granted claim) or claim-less sessions return null and fall back to
// the existing review-time resolution flow.
export async function uploadBNForSession(
  session: Session | null,
): Promise<{ businessNumber: string; businessNumberSource: "ised" } | null> {
  if (!session || session.kind !== "company" || !session.partyId) return null;
  const claims = (await rapRepo.listClaimsByParty(session.partyId)).filter((c) => c.status === "granted");
  if (claims.length !== 1) return null;
  return { businessNumber: claims[0].businessNumber, businessNumberSource: "ised" };
}

// Company-side self-claim: a logged-in company party claims the right to post
// progress on a BN'd org. Requires BOTH an explicit attestation of authorization
// AND a registry-verified BN — never grants on the strength of either alone.
export async function claimOrgForParty(
  reg: RegistryProvider,
  input: { partyId: string; bnRaw: string; attested: boolean },
): Promise<{ ok: true; legalName: string | null } | { ok: false; error: string }> {
  if (!input.attested) return { ok: false, error: "You must attest authorization" };
  const v = isValidBN(input.bnRaw);
  if (!v) return { ok: false, error: "Invalid Business Number" };
  const entity = await reg.verifyBN(v.bn9);
  if (!entity) return { ok: false, error: "BN not found in the federal registry" };
  await rapRepo.putClaim({
    businessNumber: v.bn9,
    partyId: input.partyId,
    status: "granted",
    attestedAt: new Date().toISOString(),
    grantedBy: "system:bn-verify",
  });
  return { ok: true, legalName: entity.legalName };
}

// Company-side progress append: a claimed party posts an Observation against
// one of their org's commitments. Append-only — never edits the commitment's
// grounded fields, only adds a time-stamped progress record (the
// RollupAggregator recomputes rollups off the write). Guarded by the same
// claim that gates claimOrgForParty: the commitment's orgId must resolve to a
// BN root (`org-bn-<bn>`), and the calling party must hold a granted OrgClaim
// on that BN. Direct (rapId, commitId) read — no new GSI.
export async function recordRapProgressForParty(input: {
  partyId: string;
  rapId: string;
  commitId: string;
  status: ProgressStatus;
  observedValue: number | null;
  note: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const c = await rapRepo.getCommitment(input.rapId, input.commitId);
  if (!c) return { ok: false, error: "Unknown commitment" };
  const bn = c.orgId.startsWith("org-bn-") ? c.orgId.slice("org-bn-".length) : null;
  if (!bn) return { ok: false, error: "Org has no Business Number" };
  const claim = await rapRepo.getClaim(bn, input.partyId);
  if (!claim || claim.status !== "granted") return { ok: false, error: "Not authorized for this organization" };
  if (!VALID_STATUS.has(input.status)) return { ok: false, error: "Invalid status" };
  // Server Actions are directly POST-able, so a raw form value like
  // observedValue=abc (wrapper does Number(...), which is NaN for that input)
  // can reach here. Guard against storing a non-finite value.
  const observedValue = Number.isFinite(input.observedValue) ? input.observedValue : null;
  await rapRepo.putObservation({
    commitId: input.commitId,
    observedAt: new Date().toISOString(),
    status: input.status,
    observedValue,
    note: input.note,
    recordedBy: input.partyId,
  });
  // Deployed, the rollup is recomputed asynchronously by the DynamoDB Streams
  // Lambda (src/functions/rap-rollup.ts). That Lambda never fires against the
  // in-memory mock (no Streams locally), so recompute synchronously here too —
  // same pure function, so it's a harmless no-op re-derivation when the stream
  // Lambda *does* also run against real Dynamo.
  const observations = await rapRepo.listObservations(input.commitId);
  await rapRepo.putRollup(computeRollup(input.commitId, observations));
  return { ok: true };
}
