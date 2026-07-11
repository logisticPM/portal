// Extraction QA / review queue (Idea 1, human-in-the-loop). Lists PENDING_REVIEW
// jobs — only flagged extractions land here; clean ones auto-publish. Each field
// shows its grounding (verbatim quote + page); flagged fields are highlighted so
// the reviewer's eye goes straight to what the AI was unsure about. This is
// extraction QA, NOT Indigenomics truth-verification.
import { extractionRepo } from "@/lib/rap";
import { confirmExtractionAction, rejectExtractionAction, resolveOrgAction } from "@/lib/rap/actions";
import { cbrSearchUrl } from "@/lib/rap/registry";
import type { ExtractedRap, ExtractionJob, Grounded } from "@/lib/rap";
import { labelFor } from "@/lib/taxonomy";

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
  const jobs = await extractionRepo.listByStatus("PENDING_REVIEW");

  return (
    <div className="space-y-8">
      <div>
        <div className="text-amber text-xs uppercase tracking-widest mb-1">Indigenomics · Extraction QA</div>
        <p className="text-ink3 text-sm mt-1">
          Confirm the AI read each document correctly. Clean, high-confidence extractions publish automatically and never appear here.
        </p>
      </div>

      <p className="text-ink3 text-sm">
        {jobs.length} flagged {jobs.length === 1 ? "document" : "documents"} awaiting review
      </p>

      {jobs.length === 0 && (
        <div className="bg-panel rounded border border-line p-8 text-center text-ink3">
          Nothing to review — the queue is clear.
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
