// Upload a RAP (Idea 1 entry point). Minimal form → uploadRapAction. In the mock
// build there's no real file: enter a filename and the stand-in pipeline returns
// canned data (a name containing "telus"/"flag"/"review" routes to the review
// queue; anything else auto-publishes). The real build adds a file input that
// uploads to S3 first and passes the key.
import Link from "next/link";
import { UploadForm } from "@/app/extract/UploadForm";

export const dynamic = "force-dynamic";

export default function UploadRapPage() {
  return (
    <div className="max-w-xl space-y-6">
      <div>
        <div className="text-amber text-xs uppercase tracking-widest mb-1">Indigenomics · RAP submission</div>
        <h1 className="font-serif text-3xl">Upload a Reconciliation Action Plan</h1>
        <p className="text-ink3 text-sm mt-2">
          The document is processed by AI and key fields are extracted. Clean, high-confidence
          extractions publish straight to the index; anything the AI is unsure about goes to a short
          review queue first. No third-party verification — this is extraction QA only.
        </p>
      </div>

      <UploadForm />
      <Link href="/rap" className="inline-block text-ink3 text-sm">← Back to dashboard</Link>
    </div>
  );
}
