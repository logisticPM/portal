"use client";

// Live search box. Types → debounced update of a search param (default `q`) via
// router.replace({ scroll: false }) so the view re-filters in place (no jump, no
// button). Resets the paired page param (default `page`) to 1. Reusable for the
// main list (q/page), the org leaderboard, and the risk section (rq/rpage).
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export function CommitmentSearch({
  basePath = "/commitments",
  param = "q",
  resetParam = "page",
  placeholder = "Search commitments, organizations…",
}: {
  basePath?: string;
  param?: string;
  resetParam?: string;
  placeholder?: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get(param) ?? "");
  const ref = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync from the URL (e.g. "clear all") — but never fight the user mid-type.
  useEffect(() => {
    if (ref.current && document.activeElement === ref.current) return;
    setValue(params.get(param) ?? "");
  }, [params, param]);

  function onChange(next: string) {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const p = new URLSearchParams(params.toString());
      p.delete(resetParam); // new search → back to page 1
      if (next.trim()) p.set(param, next.trim());
      else p.delete(param);
      const s = p.toString();
      router.replace(s ? `${basePath}?${s}` : basePath, { scroll: false });
    }, 250);
  }

  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      className="flex-1 min-w-[180px] rounded border border-line bg-bg/40 px-3 py-1.5 text-sm"
    />
  );
}
