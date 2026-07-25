"use client";
// Submit button for the "Generate & send now" form. Disables + relabels itself
// while the form action is pending, so a double-click during the demo can't
// fire two concurrent runDigest() calls (two emails).
import { useFormStatus } from "react-dom";

export function GenerateButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="text-sm rounded px-4 py-2 bg-amber/10 text-amber hover:bg-amber/20 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {pending ? "Generating…" : "Generate & send now"}
    </button>
  );
}
