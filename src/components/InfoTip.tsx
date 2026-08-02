import type { ReactNode } from "react";

// Pure, CSS-only hover/focus tooltip. Deliberately NOT a client component: it
// has no hooks and no event handlers, so it renders in both the server-rendered
// ReviewPanel and the client FlaggedFieldsEditor.
//
// Uses a NAMED Tailwind group (group/infotip) so it never triggers on the
// ReviewCard's own `group`/`group-open` (used for its chevron). The trigger is a
// focusable, non-submitting <span> — keyboard/touch reveal it via focus-within,
// and it's safe inside a <summary> (a click there still toggles the card, which
// is native and expected; the tip itself needs no click).
//
// The popover resets case/tracking/weight because several markers live inside
// `uppercase tracking-wide` rows — without the reset the help text would render
// shouted.
export function InfoTip({
  tip,
  label,
  children,
  align = "left",
}: {
  tip: string;
  label?: string;
  children?: ReactNode;
  align?: "left" | "right";
}) {
  const pos = align === "right" ? "right-0" : "left-0";
  return (
    <span className="relative inline-flex items-center gap-1 align-middle group/infotip">
      {children}
      <span
        tabIndex={0}
        role="note"
        aria-label={label ? `${label}: ${tip}` : tip}
        className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-ink3/50 text-[9px] font-medium leading-none text-ink3 cursor-help select-none"
      >
        i
      </span>
      <span
        role="tooltip"
        className={`pointer-events-none absolute ${pos} top-full z-10 mt-1 w-64 rounded border border-line bg-panel p-2 text-xs font-normal normal-case tracking-normal text-ink3 shadow-card opacity-0 transition-opacity duration-100 group-hover/infotip:opacity-100 group-focus-within/infotip:opacity-100`}
      >
        {tip}
      </span>
    </span>
  );
}
