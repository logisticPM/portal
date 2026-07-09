import Link from "next/link";
import type { ReactNode } from "react";

export default function CasesLayout({ children }: { children: ReactNode }) {
  return (
    <div>
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-4xl items-center gap-5 px-4 py-3 text-sm">
          <Link href="/cases" className="font-serif text-base">Legal Cases</Link>
          <nav className="flex gap-4 text-ink3">
            <Link href="/cases" className="hover:text-amber">Cases</Link>
            <Link href="/cases/activation" className="hover:text-amber">Activation</Link>
            <Link href="/cases/briefings" className="hover:text-amber">Legal info</Link>
            <Link href="/cases/monitoring" className="hover:text-amber">Monitoring</Link>
            <Link href="/cases/methodology" className="hover:text-amber">Methodology</Link>
          </nav>
        </div>
        <div className="border-t border-line bg-amber/5 px-4 py-1.5 text-center text-xs text-ink3">
          Unofficial reproductions of public court decisions · not legal advice · every claim links to its source
        </div>
      </header>
      <main className="px-4 py-6">{children}</main>
      <footer className="border-t border-line px-4 py-4 text-center text-xs text-ink3">
        Indigenomics Institute · Economic Justice Legal Cases · methodology transparent by design
      </footer>
    </div>
  );
}
