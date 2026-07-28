"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-fetch this route's Server Components while extractions are still running.
 *
 * WHY THIS EXISTS. Extraction is dispatched fire-and-forget
 * (`InvocationType: "Event"` in actions.ts) and takes ~90s for a 17-page RAP,
 * several minutes for a large one. The upload action redirects here
 * immediately, so without this the reviewer stares at a queue that will not
 * change until they think to reload — and nothing on screen suggests reloading
 * would help.
 *
 * The page is already `export const dynamic = "force-dynamic"`, so
 * router.refresh() re-runs the server query and re-renders with fresh statuses.
 * No new endpoint, no client-side data fetching.
 *
 * Polls ONLY while something is actually in flight: `active` is 0 whenever the
 * queue is settled, and the effect then registers no timer at all.
 */
export function QueueAutoRefresh({ active, intervalMs = 10_000 }: { active: number; intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    if (active <= 0) return;

    const tick = () => {
      // A background tab refreshing every 10s is pure waste — and on return the
      // visibilitychange listener below refreshes immediately, so nothing is missed.
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", tick);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [active, intervalMs, router]);

  return null;
}
