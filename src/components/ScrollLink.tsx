"use client";

// Like next/link but navigates via router.push(..., { scroll: false }) on click,
// which reliably preserves scroll position for same-page searchParam changes
// (filters / sort / pagination) where <Link scroll={false}> can still jump to top.
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

export function ScrollLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  return (
    <a
      href={href}
      className={className}
      onClick={(e) => {
        // let modified clicks (new tab, etc.) behave normally
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        router.push(href, { scroll: false });
      }}
    >
      {children}
    </a>
  );
}
