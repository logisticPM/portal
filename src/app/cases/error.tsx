"use client";

// Segment error boundary for /cases/* (App Router). Catches server-render failures —
// in production, typically a missing or unseeded LegalCases table — and renders a
// friendly fallback instead of a bare 500. Next still logs the error server-side;
// we also log client-side with the digest so support can correlate.
import { useEffect } from "react";

export default function CasesError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[cases] segment error:", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-4xl py-10">
      <h1 className="font-serif text-2xl">Case data is temporarily unavailable</h1>
      <p className="mt-2 text-sm text-ink3">
        The legal-cases corpus isn&apos;t reachable in this environment — it may not be loaded yet.
        {error.digest ? ` (ref ${error.digest})` : ""}
      </p>
      <button onClick={reset} className="mt-4 rounded bg-ink px-4 py-2 text-bg hover:bg-ink/90">
        Try again
      </button>
    </div>
  );
}
