// Company self-service: view your claimed org's RAP commitments (as extracted
// & confirmed by Indigenomics/staff review) and append your own progress.
// Company-only (middleware + this page-level gate, mirroring
// src/app/my-commitments/page.tsx). Separate data layer from that page — this
// one reads the RAP-extraction canonical entities (src/lib/rap), keyed by
// Business Number via the party's OrgClaim(s), not by session.partyId directly.
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { rapRepo } from "@/lib/rap";
import type { Commitment, CommitmentRollup, ProgressStatus, RapDocument } from "@/lib/rap";
import { recordRapProgressAction, setShowcaseOptInAction } from "@/lib/rap/actions";
import { labelFor } from "@/lib/taxonomy";
import { UploadForm } from "@/app/extract/UploadForm";

export const dynamic = "force-dynamic";

// recordRapProgressAction returns { ok, error? } for callers that want it (e.g.
// a client-side form mirroring ClaimForm); a plain <form action={...}> in a
// Server Component requires void | Promise<void>, so this inline Server Action
// (Next.js allows "use server" inline in a Server Component's function body)
// just discards the result — the form still reflects the outcome via the
// revalidated rollup below.
async function recordProgress(formData: FormData) {
  "use server";
  await recordRapProgressAction(formData);
}

// setShowcaseOptInAction returns { ok } | undefined for callers that want it;
// a plain <form action={...}> in a Server Component requires void | Promise<void>,
// so this inline Server Action just discards the result — the checkbox still
// reflects the current state via defaultChecked on the revalidated claim below.
async function setShowcaseOptIn(formData: FormData) {
  "use server";
  await setShowcaseOptInAction(formData);
}

const STATUSES: ProgressStatus[] = ["not_started", "on_track", "delayed", "met", "missed"];

const STATUS_PILL: Record<ProgressStatus, string> = {
  not_started: "text-ink3 border-ink/15",
  on_track: "text-cedar border-cedar/40 bg-cedar/10",
  delayed: "text-amber border-amber/40 bg-amber/10",
  met: "text-cedar border-cedar/40 bg-cedar/10",
  missed: "text-rust border-rust/40 bg-rust/10",
};

interface RapSection {
  rap: RapDocument;
  commitments: { commitment: Commitment; rollup: CommitmentRollup | null }[];
}

interface ClaimSection {
  businessNumber: string;
  orgId: string;
  showcaseOptIn: boolean;
  raps: RapSection[];
}

export default async function MyRapPage() {
  const session = getSession();
  if (session?.kind !== "company" || !session.partyId) redirect("/home");

  const claims = (await rapRepo.listClaimsByParty(session.partyId)).filter((c) => c.status === "granted");

  const sections: ClaimSection[] = await Promise.all(
    claims.map(async (claim) => {
      const orgId = `org-bn-${claim.businessNumber}`;
      const raps = await rapRepo.listRapsByOrg(orgId);
      const rapSections: RapSection[] = await Promise.all(
        raps.map(async (rap) => {
          const commitments = await rapRepo.listCommitmentsByRap(rap.id);
          const withRollup = await Promise.all(
            commitments.map(async (commitment) => ({
              commitment,
              rollup: await rapRepo.getRollup(commitment.id),
            })),
          );
          return { rap, commitments: withRollup };
        }),
      );
      return {
        businessNumber: claim.businessNumber,
        orgId,
        showcaseOptIn: claim.showcaseOptIn === true,
        raps: rapSections,
      };
    }),
  );

  const totalCommitments = sections.reduce(
    (n, s) => n + s.raps.reduce((m, r) => m + r.commitments.length, 0),
    0,
  );

  return (
    <div className="space-y-8">
      <div>
        <div className="text-amber text-xs uppercase tracking-widest mb-1">Company portal</div>
        <h1 className="font-serif text-3xl">My RAP</h1>
        <p className="text-ink2 text-sm mt-1">
          Your claimed organization&apos;s published RAP commitments. Grounded fields (action,
          deliverable, target, source quote) are read-only — extracted from the published
          document; record your own progress below each one.
        </p>
      </div>

      {claims.length === 0 ? (
        <section className="bg-panel rounded border border-line shadow-card p-6 text-center space-y-3">
          <p className="text-ink2 text-sm">
            You haven&apos;t claimed an organization yet. Claim your Business Number to see your
            RAP commitments and record progress.
          </p>
          <a
            href="/my-rap/claim"
            className="inline-block bg-amber/20 text-amber border border-amber/40 rounded px-4 py-2 text-sm hover:bg-amber/30"
          >
            Claim your organization
          </a>
        </section>
      ) : (
        <div className="space-y-6">
          {sections.map((s) => (
            <section key={s.orgId} className="space-y-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="text-ink3 text-xs uppercase tracking-widest">
                  Business Number {s.businessNumber}
                </div>
                <form
                  action={setShowcaseOptIn}
                  className="flex items-center gap-2 bg-panel rounded border border-line px-3 py-1.5"
                >
                  <input type="hidden" name="bn" value={s.businessNumber} />
                  <label className="flex items-center gap-2 text-xs text-ink2">
                    <input
                      type="checkbox"
                      name="optIn"
                      defaultChecked={s.showcaseOptIn}
                      className="rounded border-line"
                    />
                    Show my uploaded RAP on the public Index (as company-reported — it
                    won&apos;t change my public score)
                  </label>
                  <button className="rounded bg-ink px-2.5 py-1 text-bg text-xs hover:bg-ink/90 shrink-0">
                    Save
                  </button>
                </form>
              </div>
              {s.raps.length === 0 || s.raps.every((r) => r.commitments.length === 0) ? (
                <p className="text-ink3 text-sm bg-panel rounded border border-line p-4">
                  No published RAP found yet for this organization. Once a RAP is uploaded and
                  published, its commitments will appear here.
                </p>
              ) : (
                s.raps.map((r) => (
                  <div key={r.rap.id} className="bg-panel rounded border border-line shadow-card p-5 space-y-4">
                    <div className="flex items-baseline justify-between gap-3 flex-wrap">
                      <div className="font-serif text-lg text-ink">{r.rap.title}</div>
                      <div className="text-ink3 text-xs">
                        {r.rap.jurisdiction} · {r.rap.periodStart}–{r.rap.periodEnd}
                      </div>
                    </div>

                    <div className="space-y-3">
                      {r.commitments.map(({ commitment: c, rollup }) => (
                        <div key={c.id} className="rounded border border-line bg-bg/30 p-4 space-y-3">
                          {/* grounded fields — read-only */}
                          <div className="flex flex-wrap items-start gap-3 text-sm">
                            <div className="flex-1 min-w-[220px]">
                              <div className="font-medium text-ink">{c.action}</div>
                              <div className="text-ink2 text-xs mt-0.5">{c.deliverable}</div>
                              <div className="text-ink3 text-xs mt-1">
                                {labelFor("commitmentType", c.commitmentType)}
                                {c.targetText && <> · target: {c.targetText}</>}
                                {/* A cadence ("Annual") has no due date but IS a timeline —
                                    fall back to the document's own wording rather than
                                    rendering nothing, which read as "no timeline stated". */}
                                {c.dueDate ? <> · due {c.dueDate}</> : c.timelineText && <> · {c.timelineText}</>}
                              </div>
                              <div className="text-ink3 text-xs mt-1 italic">
                                “{c.source.quote}”{c.source.page != null && ` (p. ${c.source.page})`}
                              </div>
                            </div>
                            <span
                              className={`text-xs rounded border px-2 py-0.5 shrink-0 ${
                                STATUS_PILL[rollup?.latestStatus ?? "not_started"]
                              }`}
                            >
                              {labelFor("status", rollup?.latestStatus ?? "not_started")}
                              {" · "}
                              {rollup?.percentComplete ?? 0}%
                            </span>
                          </div>

                          {/* record-progress form */}
                          <form
                            action={recordProgress}
                            className="flex flex-wrap items-end gap-2 pt-2 border-t border-line/60"
                          >
                            <input type="hidden" name="rapId" value={r.rap.id} />
                            <input type="hidden" name="commitId" value={c.id} />
                            <label className="text-xs">
                              <span className="block text-ink3 mb-1">Status</span>
                              <select
                                name="status"
                                defaultValue={rollup?.latestStatus ?? "not_started"}
                                className="rounded border border-line bg-bg/40 px-2 py-1"
                              >
                                {STATUSES.map((st) => (
                                  <option key={st} value={st}>{labelFor("status", st)}</option>
                                ))}
                              </select>
                            </label>
                            <label className="text-xs">
                              <span className="block text-ink3 mb-1">Progress %</span>
                              <input
                                name="observedValue"
                                type="number"
                                min={0}
                                max={100}
                                defaultValue={rollup?.percentComplete ?? 0}
                                className="w-20 rounded border border-line bg-bg/40 px-2 py-1"
                              />
                            </label>
                            <label className="text-xs flex-1 min-w-[160px]">
                              <span className="block text-ink3 mb-1">Note (optional)</span>
                              <input
                                name="note"
                                placeholder="What changed?"
                                className="w-full rounded border border-line bg-bg/40 px-2 py-1"
                              />
                            </label>
                            <button className="rounded bg-ink px-3 py-1.5 text-bg text-xs hover:bg-ink/90">
                              Record progress
                            </button>
                          </form>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </section>
          ))}
          {totalCommitments === 0 && (
            <p className="text-ink3 text-sm">
              No commitments yet — upload your RAP below to get started.
            </p>
          )}
        </div>
      )}

      {/* company upload entry (Task 11 folded in): a claimed company can upload
          its own RAP; uploadRapAction auto-tags the job with the claimed BN so
          it isn't re-resolved at review. Staff still QA the extraction. */}
      <section className="space-y-3">
        <div>
          <div className="text-ink3 text-xs uppercase tracking-widest mb-1">Upload your RAP</div>
          <p className="text-ink2 text-sm">
            Upload your organization&apos;s Reconciliation Action Plan document. It is sent to
            Indigenomics for AI-assisted extraction and review; once published, its commitments
            appear here on your My RAP page.
          </p>
        </div>
        <UploadForm />
      </section>
    </div>
  );
}
