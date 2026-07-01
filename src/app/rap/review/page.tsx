// Extraction QA / review queue (Idea 1, human-in-the-loop). Lists PENDING_REVIEW
// jobs — only flagged extractions land here; clean ones auto-publish. Each field
// shows its grounding (verbatim quote + page); flagged fields are highlighted so
// the reviewer's eye goes straight to what the AI was unsure about. This is
// extraction QA, NOT Indigenomics truth-verification.
import Link from "next/link";
import { extractionRepo } from "@/lib/rap";
import { confirmExtractionAction, rejectExtractionAction } from "@/lib/rap/actions";
import type { ExtractedRap, Grounded } from "@/lib/rap";

export const dynamic = "force-dynamic";

export default async function ReviewQueuePage() {
  const jobs = await extractionRepo.listByStatus("PENDING_REVIEW");

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-amber text-xs uppercase tracking-widest mb-1">Indigenomics · Extraction QA</div>
          <h1 className="font-serif text-3xl">
            Review queue <span className="text-ink3 text-base">— {jobs.length} flagged {jobs.length === 1 ? "document" : "documents"}</span>
          </h1>
          <p className="text-ink3 text-sm mt-1">
            Confirm the AI read each document correctly. Clean, high-confidence extractions publish automatically and never appear here.
          </p>
        </div>
        <Link href="/rap" className="px-3 py-2 rounded border border-line text-sm">← Dashboard</Link>
      </div>

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
                {job.classification?.sector} · {job.classification?.jurisdiction} · engine: {job.engine} · overall confidence {Math.round((job.classification?.confidence ?? 0) * 100)}%
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

          <div className="flex gap-3 pt-2">
            <form action={confirmExtractionAction}>
              <input type="hidden" name="jobId" value={job.id} />
              <input type="hidden" name="reviewedBy" value="admin" />
              <button className="px-4 py-2 rounded bg-cedar text-white text-sm">Approve &amp; publish</button>
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

function ExtractedView({ e }: { e: ExtractedRap }) {
  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Organization" g={e.orgName} />
        <Field label="RAP title" g={e.rapTitle} />
        <Field label="Sector" g={e.sector} />
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
              <Field label="Type" g={c.commitmentType} />
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
                <span className="font-medium">{x.label}:</span> {x.value}
                <span className="text-ink3"> — “{x.quote}” p.{x.page ?? "?"}</span>
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
