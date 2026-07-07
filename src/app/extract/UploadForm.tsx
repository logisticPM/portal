"use client";

import { useState } from "react";
import { uploadRapAction } from "@/lib/rap/actions";

// Upload flow:
//   1. ask the server for a presigned PUT URL (POST /api/rap/upload-url)
//   2. if S3 is configured → PUT the file straight to S3 (no Lambda 6 MB limit),
//      then call the action with just { fileName, s3Key }
//   3. if not configured (mock dev) → call the action with { fileName } only
//   4. no file, just a typed name → mock path
// The raw file is never sent through the server action.
export function UploadForm() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const fd = new FormData(e.currentTarget);
      const file = fd.get("file");
      const typed = String(fd.get("fileName") ?? "").trim();
      const out = new FormData();

      if (file instanceof File && file.size > 0) {
        const r = await fetch("/api/rap/upload-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: file.name }),
        });
        const data = await r.json();
        out.append("fileName", file.name);
        if (data.configured) {
          const put = await fetch(data.url, { method: "PUT", body: file });
          if (!put.ok) throw new Error(`S3 upload failed (${put.status})`);
          out.append("s3Key", data.s3Key);
        }
        // not configured → mock: fileName only
      } else if (typed) {
        out.append("fileName", typed);
      } else {
        setErr("Choose a file or enter a file name.");
        setBusy(false);
        return;
      }

      await uploadRapAction(out); // redirects to /rap or /rap/review
    } catch (e: any) {
      setErr(e?.message ?? "Upload failed");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 bg-panel rounded border border-line p-6">
      <label className="block">
        <span className="text-sm">RAP document (PDF / DOCX)</span>
        <input
          type="file"
          name="file"
          accept=".pdf,.docx,.txt"
          className="mt-1 w-full text-sm file:mr-3 file:px-3 file:py-2 file:rounded file:border-0 file:bg-amber file:text-white"
        />
        <span className="text-ink3 text-xs">Uploaded directly to S3 when configured (no size limit); otherwise the name drives the mock.</span>
      </label>
      <label className="block">
        <span className="text-sm">…or a file name (mock dev, no file)</span>
        <input
          name="fileName"
          placeholder="e.g. RBC_RAP_2025.pdf"
          className="mt-1 w-full px-3 py-2 rounded border border-line"
        />
      </label>
      <p className="text-ink3 text-xs">
        Tip (mock): include “telus” or “review” in the name to see the human-review path; any other name auto-publishes.
      </p>
      {err && <p className="text-rust text-sm">{err}</p>}
      <button disabled={busy} className="px-4 py-2 rounded bg-amber text-white text-sm disabled:opacity-50">
        {busy ? "Uploading…" : "Extract & submit"}
      </button>
    </form>
  );
}
