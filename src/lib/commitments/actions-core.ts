// Testable core for company commitment edits — no "use server". actions.ts wraps
// this with the real session + repo + identity-seam dependencies. Ownership is the
// crosswalk's core behavioral change: a caller owns a row if it created it
// (orgId === partyId) OR holds a granted OrgClaim on the row's businessNumber.
import type { Commitment, CommitmentPatch, CommitmentStatus, ProgressPoint } from "./types";

// Lives here (not in actions.ts) because actions.ts is a "use server" file and
// Next.js requires every export of such a module to be an async function —
// a plain const array export breaks the production build. actions.ts imports
// this back for its own validation.
export const SUBMITTABLE_STATUS: CommitmentStatus[] = ["committed", "in_progress", "reported", "stalled"];

export interface UpdateDeps {
  getCommitment(id: string): Promise<Commitment | null>;
  updateCommitment(id: string, patch: CommitmentPatch): Promise<Commitment | null>;
  orgId: string;              // session.partyId
  claimedBNs: Set<string>;    // granted BNs from resolveOrgForParty
  now: string;                // ISO timestamp (injected for testability)
}

export async function updateCommitmentCore(
  deps: UpdateDeps,
  input: { id: string; status: CommitmentStatus; progressPct: number },
): Promise<{ ok: boolean }> {
  const cur = await deps.getCommitment(input.id);
  const owns =
    !!cur &&
    (cur.orgId === deps.orgId ||
      (!!cur.businessNumber && deps.claimedBNs.has(cur.businessNumber)));
  if (!cur || !owns) return { ok: false };
  if (!SUBMITTABLE_STATUS.includes(input.status)) return { ok: false };

  const progressPct = Math.max(0, Math.min(100, Math.round(input.progressPct)));
  const year = new Date(deps.now).getFullYear().toString();
  const point: ProgressPoint = { period: year, status: input.status, progressPct, authoredBy: deps.orgId };
  const history = [...cur.history];
  const last = history[history.length - 1];
  if (last && last.period === year) history[history.length - 1] = point;
  else history.push(point);

  await deps.updateCommitment(input.id, { status: input.status, progressPct, history });
  return { ok: true };
}
