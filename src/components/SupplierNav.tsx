"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/lib/repo/actions";

// Top-level nav for the supplier portal. Identity now lives in the session
// cookie (set at login), so links no longer need to carry ?as=.
const LINKS = [
  { href: "/confirm", label: "Confirm inbox" },
  { href: "/record", label: "My Record" },
  { href: "/profile", label: "My Profile" },
];

export function SupplierNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap items-center gap-1 border-b border-line pb-3">
      <span className="text-cedar text-xs uppercase tracking-widest mr-3">Supplier portal</span>
      {LINKS.map((l) => {
        const active = pathname === l.href;
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`text-sm rounded px-3 py-1 ${
              active ? "bg-cedar/10 text-cedar" : "text-ink2 hover:text-ink"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
      <form action={signOut} className="ml-auto">
        <button className="text-ink3 underline text-xs hover:text-ink">switch account</button>
      </form>
    </nav>
  );
}
