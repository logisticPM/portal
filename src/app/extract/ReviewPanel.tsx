// Extraction QA / review queue (Idea 1, human-in-the-loop). Lists PENDING_REVIEW
// jobs — only flagged extractions land here; clean ones auto-publish. Each field
// shows its grounding (verbatim quote + page); flagged fields are highlighted so
// the reviewer's eye goes straight to what the AI was unsure about. This is
// extraction QA, NOT Indigenomics truth-verification.
//
// It ALSO surfaces jobs that have not reached review yet, and jobs that never
// will. Previously this panel queried PENDING_REVIEW alone, which made two very
// different situations look identical — and identical to each other:
//
//   * still extracting  — dispatched fire-and-forget, ~90s for a 17-page RAP and
//     several minutes for a large one, during which the document was INVISIBLE
//   * FAILED            — markFailed() ran, and the job then appeared nowhere at
//     all, so a hard error was indistinguishable from a slow success
//
// The second is why the Textract SCP deny read as "extraction is dead" rather
// than as a specific failure: every job failed in under a second and the queue
// showed nothing. Both statuses were already stored; only the query was narrow.
import { extractionRepo } from "@/lib/rap";
import { confirmExtractionAction, rejectExtractionAction, resolveOrgAction } from "@/lib/rap/actions";
import { cbrSearchUrl } from "@/lib/rap/registry";
import type { ExtractedRap, ExtractionJob, Grounded } from "@/lib/rap";
import { labelFor } from "@/lib/taxonomy";
import { QueueAutoRefresh } from "./QueueAutoRefresh";
import { elapsedSince, isStalled, orderFailed, orderInProgress } from "./queue-view";

// `<form action>` requires a function returning void | Promise<void>, but
// resolveOrgAction (a thin shim over the testable resolveOrgForJob core)
// returns an { ok, ... } result for programmatic/test callers. Discard it
// here via an inline Server Action — the confirmation line and the Approve
// button's disabled state re-derive from job.businessNumber/registryLegalName
// once Next.js refreshes this route's Server Components after the action.
async function resolveOrgFormAction(formData: FormData) {
  "use server";
  await resolveOrgAction(formData);
}

export async function ReviewPanel() {
  // One query per status: listByStatus is a GSI1 point query per status value,
  // so four of them in parallel cost the same round trip as one.
  const [jobs, pending, extracting, failed] = await Promise.all([
    extractionRepo.listByStatus("PENDING_REVIEW"),
    extractionRepo.listByStatus("PENDING"),
    extractionRepo.listByStatus("EXTRACTING"),
    extractionRepo.listByStatus("FAILED"),
  ]);

  // PENDING means the worker has not picked the job up yet; EXTRACTING means it
  // is mid-pipeline. The distinction matters when diagnosing (a job stuck in
  // PENDING points at the Lambda invoke, not the pipeline), so the row keeps it
  // — but both are simply "in progress" to a reviewer.
  const inProgress = orderInProgress(pending, extracting);
  const failedJobs = orderFailed(failed);
  // One clock reading for the whole render, so two rows never disagree about
  // what time it is. Safe on the server: the route is force-dynamic and
  // QueueAutoRefresh re-renders it while anything is running.
  const now = Date.now();

  return (
    <div className="space-y-8">
      {/* Polls only while inProgress.length > 0; renders nothing. */}
      <QueueAutoRefresh active={inProgress.length} />

      <div>
        <div className="text-amber text-xs uppercase tracking-widest mb-1">Indigenomics · Extraction QA</div>
        <p className="text-ink3 text-sm mt-1">
          Confirm the AI read each document correctly. Clean, high-confidence extractions publish automatically and never appear here.
        </p>
      </div>

      {inProgress.length > 0 && <InProgressList jobs={inProgress} now={now} />}
      {failedJobs.length > 0 && <FailedList jobs={failedJobs} now={now} />}

      <p className="text-ink3 text-sm">
        {jobs.length} flagged {jobs.length === 1 ? "document" : "documents"} awaiting review
      </p>

      {jobs.length === 0 && (
        <div className="bg-panel rounded border border-line p-8 text-center text-ink3">
          {inProgress.length > 0
            ? "Nothing to review yet — extraction is still running."
            : "Nothing to review — the queue is clear."}
        </div>
      )}

      {jobs.map((job) => (
        <div key={job.id} className="bg-panel rounded border border-line shadow-card p-6 space-y-4">
          <div className="flex justify-between items-start gap-4">
            <div>
              <div className="font-medium">{job.fileName}</div>
              <div className="text-ink3 text-sm">
                {job.classification && labelFor("sector", job.classification.sector)} · {job.classification?.jurisdiction} · engine: {job.engine} · overall confidence {Math.round((job.classification?.confidence ?? 0) * 100)}%
              </div>
            </div>
          </div>

          {job.validationIssues.length > 0 && (
            <div className="rounded border border-rust/40 bg-rust/5 p-3 text-sm">
              <div className="text-rust font-medium mb-1">Validation issues</div>
              <ul className="list-disc ml-5 text-ink3">
                {job.validationIssues.map((v, i) => (
                  <li key={i}><code>{v.path}</code> — {v.rule}: {v.message}</li>
                ))}
              </ul>
            </div>
          )}

          {job.extracted && <ExtractedView e={job.extracted} />}

          <OrgBlock job={job} />

          <div className="flex gap-3 pt-2">
            <form action={confirmExtractionAction}>
              <input type="hidden" name="jobId" value={job.id} />
              <input type="hidden" name="reviewedBy" value="admin" />
              <button
                disabled={job.businessNumber == null}
                className="px-4 py-2 rounded bg-cedar text-white text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Approve &amp; publish
              </button>
            </form>
            <form action={rejectExtractionAction} className="flex gap-2">
              <input type="hidden" name="jobId" value={job.id} />
              <input type="hidden" name="reviewedBy" value="admin" />
              <input name="reason" placeholder="Reason (optional)" className="px-3 py-2 rounded border border-line text-sm" />
              <button className="px-4 py-2 rounded border border-rust text-rust text-sm">Reject</button>
            </form>
          </div>
        </div>
      ))}
    </div>
  );
}

function InProgressList({ jobs, now }: { jobs: ExtractionJob[]; now: number }) {
  return (
    <div className="space-y-2">
      <div className="text-ink3 text-xs uppercase tracking-widest">
        Extracting — {jobs.length} {jobs.length === 1 ? "document" : "documents"}
      </div>
      {jobs.map((job) => {
        const stalled = isStalled(job, now);
        return (
          <div key={job.id} className="bg-panel rounded border border-line p-4 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="font-medium truncate">{job.fileName}</div>
              <div className="text-ink3 text-sm">
                {job.status === "PENDING" ? "Queued" : "Reading the document and extracting commitments"} · {elapsedSince(job.createdAt, now)} elapsed
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {/* aria-hidden: the adjacent text already states the status, so the
                  animation is decoration and would otherwise be announced twice. */}
              <span aria-hidden className="inline-block w-2 h-2 rounded-full bg-amber animate-pulse" />
              <span className={`text-xs uppercase tracking-wide ${stalled ? "text-rust" : "text-amber"}`}>
                {stalled ? "taking longer than usual" : "in progress"}
              </span>
            </div>
          </div>
        );
      })}
      <p className="text-ink3 text-xs">
        This list refreshes on its own. Extraction runs in the background — you can leave this page.
      </p>
    </div>
  );
}

// A FAILED job used to appear nowhere, so a hard error looked exactly like an
// empty queue. markFailed() stores the reason in reviewNote (repo.dynamo.ts),
// which is the only place the operator can see it without CloudWatch.
function FailedList({ jobs, now }: { jobs: ExtractionJob[]; now: number }) {
  return (
    <div className="space-y-2">
      <div className="text-rust text-xs uppercase tracking-widest">
        Failed — {jobs.length} {jobs.length === 1 ? "document" : "documents"}
      </div>
      {jobs.map((job) => (
        <div key={job.id} className="rounded border border-rust/40 bg-rust/5 p-4 space-y-1">
          <div className="flex items-baseline justify-between gap-4">
            <div className="font-medium truncate">{job.fileName}</div>
            <div className="text-ink3 text-xs shrink-0">{elapsedSince(job.updatedAt, now)} ago</div>
          </div>
          {job.reviewNote ? (
            <pre className="text-rust text-xs whitespace-pre-wrap break-words font-mono">{job.reviewNote}</pre>
          ) : (
            <div className="text-ink3 text-xs">No error recorded — check CloudWatch for this job id.</div>
          )}
          <div className="text-ink3 text-[11px] font-mono">job {job.id}</div>
        </div>
      ))}
    </div>
  );
}

// BN-keyed org identity, resolved by the reviewer before a job can publish
// (mirrors `canPublish` in actions-core.ts: businessNumber must be non-null).
function OrgBlock({ job }: { job: ExtractionJob }) {
  const orgName = job.extracted?.orgName?.value ?? job.fileName;
  return (
    <div className="rounded border border-line p-4 space-y-3">
      <div className="text-ink3 text-xs uppercase tracking-widest">Organization</div>

      <div className="flex flex-wrap justify-between items-center gap-3">
        <div className="text-sm font-medium">{orgName}</div>
        <a
          href={cbrSearchUrl(orgName)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-cedar text-sm underline"
        >
          Look up in Canada&apos;s Business Registries ↗
        </a>
      </div>

      {job.registryLegalName ? (
        <div className="text-sm rounded border border-cedar/40 bg-cedar/5 p-2">
          Resolved: <span className="font-medium">{job.registryLegalName}</span>
          {job.registryStatus ? ` · ${job.registryStatus}` : ""}
        </div>
      ) : (
        <div className="text-rust text-xs">Not yet resolved — required before publish.</div>
      )}

      <form action={resolveOrgFormAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="jobId" value={job.id} />
        <input
          name="bn"
          placeholder="Business Number (9 digits)"
          defaultValue={job.businessNumber ?? ""}
          className="px-3 py-2 rounded border border-line text-sm"
        />
        <label className="text-ink3 text-xs flex items-center gap-1">
          <input type="checkbox" name="selfAsserted" />
          Self-asserted (no registry match)
        </label>
        <button className="px-4 py-2 rounded border border-line text-sm">Resolve</button>
      </form>
    </div>
  );
}

function ExtractedView({ e }: { e: ExtractedRap }) {
  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Organization" g={e.orgName} />
        <Field label="RAP title" g={e.rapTitle} />
        <Field
          label="Sector"
          g={e.sector.value ? { ...e.sector, value: labelFor("sector", e.sector.value) } : e.sector}
        />
        <Field label="Jurisdiction" g={e.jurisdiction} />
        <Field label="Published" g={e.publicationDate} />
        <Field label="Governance body" g={e.governanceBody} />
      </div>

      <div>
        <div className="text-ink3 text-xs uppercase tracking-widest mb-2">Commitments</div>
        <div className="space-y-3">
          {e.commitments.map((c, i) => (
            <div key={i} className="rounded border border-line p-3 grid sm:grid-cols-2 gap-2">
              <Field label="Action" g={c.action} />
              <Field label="Deliverable" g={c.deliverable} />
              <Field label="Timeline" g={c.timeline} />
              <Field label="Owner" g={c.owner} />
              <Field label="Metric / target" g={c.metric} />
              <Field
                label="Type"
                g={c.commitmentType.value ? { ...c.commitmentType, value: labelFor("commitmentType", c.commitmentType.value) } : c.commitmentType}
              />
            </div>
          ))}
        </div>
      </div>

      {e.extras.length > 0 && (
        <div>
          <div className="text-ink3 text-xs uppercase tracking-widest mb-2">Unmapped fields (extras)</div>
          <ul className="text-sm space-y-1">
            {e.extras.map((x, i) => (
              <li key={i}>
                <span className="font-medium">{x.label ? `${x.label}:` : ""}</span> {x.value}
                {(x.quote || x.page != null) && (
                  <span className="text-ink3"> — {x.quote ? `“${x.quote}”` : ""}{x.page != null ? ` p.${x.page}` : ""}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// Render a grounded field. Flagged ⇒ amber outline + the verbatim quote so the
// reviewer can judge the value against its source span.
function Field({ label, g }: { label: string; g: Grounded<unknown> }) {
  const display = g.value === null ? "—" : typeof g.value === "object" ? JSON.stringify(g.value) : String(g.value);
  return (
    <div className={`rounded p-2 ${g.flagged ? "border border-amber bg-amber/5" : ""}`}>
      <div className="text-ink3 text-[11px] uppercase tracking-wide flex justify-between">
        <span>{label}</span>
        <span>{Math.round(g.confidence * 100)}%{g.flagged ? " · review" : ""}</span>
      </div>
      <div className="text-sm">{display}</div>
      {g.quote ? (
        <div className="text-ink3 text-xs mt-1">“{g.quote}”{g.page ? ` · p.${g.page}` : ""}</div>
      ) : (
        <div className="text-rust text-xs mt-1">no source span</div>
      )}
    </div>
  );
}
