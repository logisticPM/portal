"use client";

// "Go to page" input for the RAP Index list. Jumps to the entered page (clamped)
// via router.replace({ scroll: false }) so it stays in place and keeps filters.
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export function PageJump({
  totalPages,
  basePath = "/commitments",
  param = "page",
}: {
  totalPages: number;
  basePath?: string;
  param?: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [v, setV] = useState("");

  function go() {
    const n = Math.min(totalPages, Math.max(1, Math.floor(Number(v)) || 1));
    const p = new URLSearchParams(params.toString());
    if (n > 1) p.set(param, String(n));
    else p.delete(param);
    const s = p.toString();
    router.replace(s ? `${basePath}?${s}` : basePath, { scroll: false });
    setV("");
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        go();
      }}
      className="flex items-center gap-1"
    >
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        inputMode="numeric"
        placeholder="Go to…"
        aria-label="Go to page"
        className="w-16 rounded border border-line bg-bg/40 px-2 py-1 text-xs"
      />
      <button className="rounded border border-line px-2 py-1 text-ink2 hover:text-ink hover:border-ink/30">
        Go
      </button>
    </form>
  );
}
