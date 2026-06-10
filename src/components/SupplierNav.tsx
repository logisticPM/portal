"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

// Top-level nav for the supplier portal. No real auth — the `?as=<supplierId>` query
// is the demo "who am I" context; carry it across the inbox/record links so switching
// pages keeps you signed in as the same supplier.
const LINKS: { href: string; label: string; keepAs: boolean }[] = [
  { href: "/confirm", label: "Confirm inbox", keepAs: true },
  { href: "/record", label: "My Record", keepAs: true },
  { href: "/register", label: "Register", keepAs: false },
];

export function SupplierNav() {
  const pathname = usePathname();
  const as = useSearchParams().get("as");

  return (
    <nav className="flex flex-wrap items-center gap-1 border-b border-line pb-3">
      <span className="text-cedar text-xs uppercase tracking-widest mr-3">Supplier portal</span>
      {LINKS.map((l) => {
        const href = l.keepAs && as ? `${l.href}?as=${as}` : l.href;
        const active = pathname === l.href;
        return (
          <Link
            key={l.href}
            href={href}
            className={`text-sm rounded px-3 py-1 ${
              active ? "bg-cedar/10 text-cedar" : "text-ink2 hover:text-ink"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
      <Link href="/" className="ml-auto text-ink3 underline text-xs">
        switch portal
      </Link>
    </nav>
  );
}
