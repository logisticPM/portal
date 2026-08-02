import Link from "next/link";
import type { ReactNode } from "react";
import { CasesNav } from "./CasesNav";

export default function CasesLayout({ children }: { children: ReactNode }) {
  return (
    <div>
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-4xl items-center gap-5 px-4 py-3 text-sm">
          <Link href="/cases" className="font-serif text-base">Legal Cases</Link>
          <CasesNav />
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
