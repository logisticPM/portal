"use client";

// Live search box for the RAP Index. Types → debounced update of the `q` search
// param via router.replace({ scroll: false }) so the dashboard re-filters in place
// (no jump to top, no Search button). Preserves the other active filters.
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export function CommitmentSearch({ basePath = "/commitments" }: { basePath?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get("q") ?? "");
  const ref = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync from the URL (e.g. "clear all") — but never fight the user mid-type.
  useEffect(() => {
    if (ref.current && document.activeElement === ref.current) return;
    setValue(params.get("q") ?? "");
  }, [params]);

  function onChange(next: string) {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const p = new URLSearchParams(params.toString());
      p.delete("page"); // new search → back to page 1
      if (next.trim()) p.set("q", next.trim());
      else p.delete("q");
      const s = p.toString();
      router.replace(s ? `${basePath}?${s}` : basePath, { scroll: false });
    }, 250);
  }

  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Search commitments, organizations…"
      aria-label="Search commitments"
      className="flex-1 min-w-[180px] rounded border border-line bg-bg/40 px-3 py-1.5 text-sm"
    />
  );
}
