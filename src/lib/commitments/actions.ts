"use server";

// Company self-submission of RAP commitments. A company manages only its own
// commitments (scoped by session.partyId → orgId). Status is capped at
// "reported" — "confirmed" is the portal's verification layer, not self-serve.
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { repo } from "@/lib/repo";
import { commitmentsRepo } from "./index";
import { slugifyOrg } from "./orgs";
import type {
  Commitment,
  CommitmentStatus,
  CommitmentType,
  OrgSize,
  Sector,
} from "./types";

const SUBMITTABLE_STATUS: CommitmentStatus[] = ["committed", "in_progress", "reported", "stalled"];

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
    history: [{ period, status, progressPct }],
    createdAt: new Date().toISOString(),
  };
  await commitmentsRepo.createCommitment(c);
  revalidate();
}

export async function updateCommitmentAction(formData: FormData) {
  const ctx = await companyContext();
  if (!ctx) return;
  const id = String(formData.get("id") ?? "");
  const cur = await commitmentsRepo.getCommitment(id);
  if (!cur || cur.orgId !== ctx.orgId) return; // only your own

  const status = String(formData.get("status")) as CommitmentStatus;
  const progressPct = clampPct(formData.get("progressPct"));
  if (!SUBMITTABLE_STATUS.includes(status)) return;

  // update the current-year history point (append if this year isn't tracked yet)
  const year = String(new Date().getFullYear());
  const hist = [...cur.history];
  const last = hist[hist.length - 1];
  const point = { period: year, status, progressPct };
  if (last && last.period === year) hist[hist.length - 1] = point;
  else hist.push(point);

  await commitmentsRepo.updateCommitment(id, { status, progressPct, history: hist });
  revalidate();
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
