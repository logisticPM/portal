"use client";

// Calls claimOrgAction (src/lib/rap/actions.ts) directly as an async function
// and manages busy/result state locally — this repo's react-dom (18.3) predates
// useFormState/useActionState, so this mirrors the existing pattern in
// src/app/extract/UploadForm.tsx rather than reaching for a hook that isn't
// installed.
import { useState } from "react";
import { claimOrgAction } from "@/lib/rap/actions";

type Result = { ok: true; legalName: string | null } | { ok: false; error: string };

export function ClaimForm() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const fd = new FormData(e.currentTarget);
      const out = await claimOrgAction(fd);
      setResult(out ?? { ok: false, error: "Could not claim this organization." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 bg-panel rounded border border-line shadow-card p-5">
      <label className="block">
        <span className="block text-ink3 text-xs uppercase tracking-widest mb-1">Business Number</span>
        <input
          name="bn"
          type="text"
          inputMode="numeric"
          placeholder="e.g. 123456789"
          required
          className="w-full bg-bg border border-ink/15 rounded px-3 py-2"
        />
        <span className="text-ink3 text-xs">9-digit federal BN (program suffix like RC0001 is optional).</span>
      </label>

      <label className="flex items-start gap-2 text-sm text-ink2">
        <input type="checkbox" name="attested" className="mt-0.5" required />
        <span>
          I attest that I am authorized to claim this organization on behalf of my company.
        </span>
      </label>

      {result && result.ok && (
        <p role="status" className="bg-cedar/10 text-cedar border border-cedar/40 rounded px-3 py-2 text-sm">
          Claimed: {result.legalName ?? "(registry has no legal name on file)"}
        </p>
      )}
      {result && !result.ok && (
        <p role="alert" className="bg-rose-50 text-rose-800 border border-rose-200 rounded px-3 py-2 text-sm">
          {result.error}
        </p>
      )}

      <button
        disabled={busy}
        className="bg-amber/20 text-amber border border-amber/40 rounded px-4 py-2 hover:bg-amber/30 disabled:opacity-50"
      >
        {busy ? "Claiming…" : "Claim organization"}
      </button>
    </form>
  );
}
