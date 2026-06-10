import type { Metadata } from "next";
import { Fraunces, Hanken_Grotesk } from "next/font/google";
import "./globals.css";

const display = Fraunces({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-display",
  display: "swap",
});

const body = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Indigenomics Data Portal — Demo",
  description: "Consent-based, verified economic data — demo on synthetic data",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className="min-h-screen">
        <header className="border-b border-line px-6 py-4 flex items-center justify-between">
          <a href="/" className="font-serif text-lg">
            Indigenomics <span className="text-amber italic">Data Portal</span>
          </a>
          <span className="text-xs uppercase tracking-[0.18em] text-ink3">
            demo · synthetic data
          </span>
        </header>
        <main className="px-6 py-10 max-w-5xl mx-auto">{children}</main>
      </body>
    </html>
  );
}
