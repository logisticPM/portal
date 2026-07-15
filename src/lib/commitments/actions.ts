"use server";

// Company self-submission of RAP commitments. A company manages only its own
// commitments (scoped by session.partyId → orgId). Status is capped at
// "reported" — "confirmed" is the portal's verification layer, not self-serve.
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { resolveOrgForParty } from "@/lib/identity";
import { repo } from "@/lib/repo";
import { SUBMITTABLE_STATUS, updateCommitmentCore } from "./actions-core";
import { commitmentsRepo } from "./index";
import { slugifyOrg } from "./orgs";
import type {
  Commitment,
  CommitmentStatus,
  CommitmentType,
  OrgSize,
  Sector,
} from "./types";

function revalidate() {
  revalidatePath("/my-commitments");
  revalidatePath("/commitments");
  revalidatePath("/organizations");
}

async function companyContext() {
  const session = getSession();
  if (session?.kind !== "company" || !session.partyId) return null;
  const party = await repo.getParty(session.partyId);
  return { orgId: session.partyId, orgName: party?.name ?? session.partyId };
}

function clampPct(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
}

export async function createCommitmentAction(formData: FormData) {
  const ctx = await companyContext();
  if (!ctx) return;

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  const sector = String(formData.get("sector")) as Sector;
  const orgSize = String(formData.get("orgSize")) as OrgSize;
  const type = String(formData.get("type")) as CommitmentType;
  const targetYear = Number(formData.get("targetYear"));
  const status = String(formData.get("status")) as CommitmentStatus;
  const progressPct = clampPct(formData.get("progressPct"));
  if (!SUBMITTABLE_STATUS.includes(status)) return;
  if (!Number.isFinite(targetYear)) return;

  const { bns } = await resolveOrgForParty(ctx.orgId);
  const businessNumber = bns.length === 1 ? bns[0] : undefined; // exactly-one-claim rule

  const period = String(new Date().getFullYear());
  const c: Commitment = {
    id: `cm-${slugifyOrg(ctx.orgName)}-${type}-${Date.now().toString(36)}`,
    orgName: ctx.orgName,
    orgId: ctx.orgId,
    sector,
    orgSize,
    type,
    title,
    targetYear,
    status,
    progressPct,
    businessNumber,
    history: [{ period, status, progressPct, authoredBy: ctx.orgId }],
    createdAt: new Date().toISOString(),
  };
  await commitmentsRepo.createCommitment(c);
  revalidate();
}

export async function updateCommitmentAction(formData: FormData) {
  const ctx = await companyContext();
  if (!ctx) return;
  const { bns } = await resolveOrgForParty(ctx.orgId);
  const res = await updateCommitmentCore(
    {
      getCommitment: (id) => commitmentsRepo.getCommitment(id),
      updateCommitment: (id, patch) => commitmentsRepo.updateCommitment(id, patch),
      orgId: ctx.orgId,
      claimedBNs: new Set(bns),
      now: new Date().toISOString(),
    },
    {
      id: String(formData.get("id") ?? ""),
      status: String(formData.get("status")) as CommitmentStatus,
      progressPct: clampPct(formData.get("progressPct")),
    },
  );
  if (res.ok) revalidate();
}

export async function deleteCommitmentAction(formData: FormData) {
  const ctx = await companyContext();
  if (!ctx) return;
  const id = String(formData.get("id") ?? "");
  const cur = await commitmentsRepo.getCommitment(id);
  if (!cur || cur.orgId !== ctx.orgId) return;
  await commitmentsRepo.deleteCommitment(id);
  revalidate();
}
