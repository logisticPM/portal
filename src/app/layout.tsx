import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Indigenomics Data Portal — Demo",
  description: "Consent-based, verified economic data — demo on synthetic data",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
          <a href="/" className="font-serif text-lg">
            Indigenomics <span className="text-amber italic">Data Portal</span>
          </a>
          <span className="text-xs uppercase tracking-widest text-ink3">
            demo · synthetic data
          </span>
        </header>
        <main className="px-6 py-8 max-w-5xl mx-auto">{children}</main>
      </body>
    </html>
  );
}
