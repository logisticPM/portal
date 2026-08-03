"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CASES_TABS, activeHref } from "./nav-active";

export function CasesNav() {
  const active = activeHref(usePathname() ?? "/cases");
  return (
    <nav className="flex gap-4 text-ink3">
      {CASES_TABS.map((t) => {
        const on = t.href === active;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={on ? "page" : undefined}
            className={on
              ? "text-amber underline decoration-amber/40 underline-offset-4"
              : "hover:text-amber"}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
