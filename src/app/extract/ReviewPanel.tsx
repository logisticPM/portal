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
import { confirmExtractionAction, dismissExtractionAction, openSourceAction, rejectExtractionAction, resolveOrgAction, retryExtractionAction } from "@/lib/rap/actions";
import { cbrSearchUrl } from "@/lib/rap/registry";
import type { ExtractedRap, ExtractionJob, Grounded } from "@/lib/rap";
import { labelFor } from "@/lib/taxonomy";
import { summarizeIssues } from "@/lib/rap/validation-display";
import type { FieldEntry, IssueSummary } from "@/lib/rap/validation-display";
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
        <ReviewCard key={job.id} job={job} />
      ))}
    </div>
  );
}

// One flagged document. Collapsed by default to a single scannable summary row
// (filename + meta + a triage badge) so a queue of many-commitment RAPs no
// longer stacks into an endless page. Native <details> keeps this a server
// component — no client JS — matching the disclosure idiom in cases/ui.tsx and
// notifications/page.tsx. Expanding reveals the redesigned issue panel, the full
// extraction, org resolution, and the Approve/Reject actions.
function ReviewCard({ job }: { job: ExtractionJob }) {
  const summary = summarizeIssues(job.validationIssues, job.extracted);
  const needsBn = job.businessNumber == null;
  return (
    <details className="bg-panel rounded border border-line shadow-card group">
      <summary className="p-6 cursor-pointer list-none [&::-webkit-details-marker]:hidden flex justify-between items-start gap-4">
        <div className="min-w-0">
          <div className="font-medium">{job.fileName}</div>
          <div className="text-ink3 text-sm">
            {job.classification && labelFor("sector", job.classification.sector)} · {job.classification?.jurisdiction} · engine: {job.engine} · overall confidence {Math.round((job.classification?.confidence ?? 0) * 100)}%
          </div>
          <TriageBadges summary={summary} needsBn={needsBn} />
        </div>
        {/* Rotates when the card is open; the whole summary row toggles it. */}
        <span aria-hidden className="text-ink3 text-sm shrink-0 transition-transform group-open:rotate-90">▸</span>
      </summary>

      <div className="px-6 pb-6 space-y-4">
        {job.validationIssues.length > 0 && <IssuePanel summary={summary} jobId={job.id} />}

        {job.extracted && <ExtractedView e={job.extracted} />}

        <OrgBlock job={job} />

        <div className="flex gap-3 pt-2">
          <form action={confirmExtractionAction}>
            <input type="hidden" name="jobId" value={job.id} />
            <input type="hidden" name="reviewedBy" value="admin" />
            <button
              disabled={needsBn}
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
    </details>
  );
}

// At-a-glance triage on the collapsed row: whether the document itself is
// suspect, how many fields need a look, and whether it can even be published
// yet (BN required). Lets a reviewer prioritise without expanding every card.
function TriageBadges({ summary, needsBn }: { summary: IssueSummary; needsBn: boolean }) {
  const badge = (text: string, tone: "warn" | "info" | "ok") => {
    const cls =
      tone === "warn" ? "border-rust/40 bg-rust/5 text-rust"
      : tone === "ok" ? "border-cedar/40 bg-cedar/5 text-cedar"
      : "border-line bg-line/10 text-ink3";
    return <span className={`inline-block rounded border px-2 py-0.5 text-xs ${cls}`}>{text}</span>;
  };
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {summary.document.length > 0 && badge("⚠ document text may be damaged", "warn")}
      {summary.fieldCount > 0 && badge(`${summary.fieldCount} ${summary.fieldCount === 1 ? "field" : "fields"} to check`, "info")}
      {needsBn ? badge("needs Business Number", "info") : badge("ready to publish", "ok")}
    </div>
  );
}

// The redesigned "what to check" panel. Leads with the document-level root cause
// (so a damaged PDF is not mistaken for a hallucinating AI), then groups the
// field-level issues by rule. Each flagged field is an EVIDENCE CARD — the value
// the AI read, the quote it cited, the page, and a one-click link that opens the
// source PDF at that page — so a reviewer has an actual starting point, not a
// bare `commitments[34].pillarRaw`. Presentation only; the gate that sent this
// job to review is unchanged.
function IssuePanel({ summary, jobId }: { summary: IssueSummary; jobId: string }) {
  return (
    <div className="rounded border border-rust/40 bg-rust/5 p-3 text-sm space-y-3">
      <div className="text-rust font-medium">What to check before publishing</div>

      {summary.document.length > 0 && (
        <div className="space-y-1">
          {summary.document.map((d, i) => (
            <div key={i}>
              <div className="font-medium text-ink2">{labelForDocIssue(d.rule)}</div>
              <div className="text-ink3">{d.message}</div>
            </div>
          ))}
          {/* Page-less link to the whole document for the damaged/low-coverage case. */}
          <SourcePdfLink jobId={jobId} label="Open source PDF ↗" />
        </div>
      )}

      {summary.fieldGroups.length > 0 && (
        <div className="space-y-3">
          {summary.fieldGroups.map((g) => (
            <div key={g.rule}>
              <div className="text-ink2 mb-1">
                <span className="font-medium">{g.label}</span> — {g.count} {g.count === 1 ? "field" : "fields"}
              </div>
              {/* Tie the quote failures back to the damaged text so they don't
                  read as independent hallucination warnings. */}
              {g.rule === "quote_not_found" && summary.hasDamage && (
                <div className="text-ink3 text-xs mb-2">
                  Expected here — the document text is damaged (see above), so the AI&apos;s quotes can&apos;t be matched word-for-word. Spot-check these against the source PDF.
                </div>
              )}
              <div className="space-y-2">
                {g.fields.map((entry, i) => (
                  <EvidenceCard key={i} entry={entry} rule={g.rule} jobId={jobId} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// One flagged field, resolved to what the reviewer needs: the value the AI read,
// the quote it cited (framed by rule), the page, and a jump-to-PDF link. Falls
// back to the raw path if resolution failed (defensive; shouldn't happen).
function EvidenceCard({ entry, rule, jobId }: { entry: FieldEntry; rule: string; jobId: string }) {
  const r = entry.resolved;
  if (!r) {
    return <div className="rounded border border-line bg-panel/60 p-2 text-xs"><code>{entry.path}</code></div>;
  }
  const value = displayGroundedValue(r.g);
  const quote = r.g.quote;
  const page = r.page;
  return (
    <div className="rounded border border-line bg-panel/60 p-2">
      <div className="text-ink3 text-[11px] uppercase tracking-wide">{r.label}</div>
      <div className="text-sm">
        <span className="text-ink3">AI read this as:</span> {value}
      </div>
      {quote ? (
        <div className="text-ink3 text-xs mt-1">
          {rule === "quote_not_found" ? "Cited (couldn't match): " : "Cited: "}“{quote}”{page ? ` · p.${page}` : ""}
        </div>
      ) : (
        <div className="text-rust text-xs mt-1">No source quote given — locate this in the document.</div>
      )}
      {page != null && <SourcePdfLink jobId={jobId} page={page} label={`Open source PDF at p.${page} ↗`} />}
    </div>
  );
}

// A no-JS "open the source PDF (at page N)" link: a form posting to the guarded
// openSourceAction, which redirects to a freshly presigned URL. target="_blank"
// so it opens in a new tab and the #page=N fragment lands the native viewer on
// the right page.
function SourcePdfLink({ jobId, page, label }: { jobId: string; page?: number; label: string }) {
  return (
    <form action={openSourceAction} target="_blank" className="mt-1">
      <input type="hidden" name="jobId" value={jobId} />
      {page != null && <input type="hidden" name="page" value={page} />}
      <button className="text-cedar text-xs underline">{label}</button>
    </form>
  );
}

// Mirror the Field component's value formatting: em dash for null, JSON for
// objects (periodCovered, frameworkRefs arrays), string otherwise.
function displayGroundedValue(g: Grounded<unknown>): string {
  if (g.value === null || g.value === undefined) return "—";
  return typeof g.value === "object" ? JSON.stringify(g.value) : String(g.value);
}

// The document-level rules already carry a full explanatory message from the
// pipeline; this is just the short heading above it.
function labelForDocIssue(rule: string): string {
  if (rule === "source_text_damaged") return "Document text may be damaged";
  if (rule === "low_page_coverage") return "Low text coverage";
  return rule;
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
          <div className="text-ink3 text-[11px] font-mono">
            job {job.id}
            {/* Surfaced only after a retry: on a first failure it is noise, but
                "attempt 3" is what tells an operator the failure is
                deterministic and retrying again is pointless. */}
            {job.attempts > 1 ? ` · attempt ${job.attempts}` : ""}
          </div>

          {/* Plain server-action forms, like Approve/Reject above — no client
              JS, so these work before hydration. Retry lands the job on PENDING,
              which moves this row up into the Extracting list on the next
              refresh; that refresh is already running because inProgress > 0. */}
          <div className="flex gap-3 pt-2">
            <form action={retryExtractionAction}>
              <input type="hidden" name="jobId" value={job.id} />
              <button className="px-3 py-1.5 rounded bg-rust text-white text-sm">Retry extraction</button>
            </form>
            <form action={dismissExtractionAction}>
              <input type="hidden" name="jobId" value={job.id} />
              <input type="hidden" name="reviewedBy" value="admin" />
              <button className="px-3 py-1.5 rounded border border-line text-ink3 text-sm">Dismiss</button>
            </form>
          </div>
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

      {/* Nested disclosure: a 35-commitment RAP would otherwise make even an
          expanded review card enormous. Collapsed by default; the count is
          visible so the reviewer knows how much is inside. */}
      <details>
        <summary className="text-ink3 text-xs uppercase tracking-widest mb-2 cursor-pointer">
          Commitments ({e.commitments.length}) — show
        </summary>
        <div className="space-y-3 mt-2">
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
      </details>

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
