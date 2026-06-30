import type { Metadata } from "next";
import { Fraunces, Hanken_Grotesk } from "next/font/google";
import "./globals.css";
import { repo } from "@/lib/repo";
import { getSession } from "@/lib/auth";
import { signOut } from "@/lib/repo/actions";
import { ThemeMenu } from "@/components/ThemeMenu";

// Runs before paint to apply the stored theme (avoids a light→dark flash).
// Mirrors applyTheme() in ThemeMenu.tsx.
const NO_FLASH = `(function(){try{var t=JSON.parse(localStorage.getItem('portal-theme')||'null');if(!t)return;var m=t.mode==='dark'?'dark':'light';var r=document.documentElement;if(m==='dark')r.classList.add('dark');var c=t[m];if(!c)return;function h(x){if(!x)return null;x=x.replace('#','');if(x.length===3)x=x[0]+x[0]+x[1]+x[1]+x[2]+x[2];var n=parseInt(x,16);return ((n>>16)&255)+' '+((n>>8)&255)+' '+(n&255);}var bg=h(c.bg);if(bg)r.style.setProperty('--bg',bg);var a=h(c.accent);if(a)r.style.setProperty('--amber',a);}catch(e){}})();`;

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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = getSession();
  let label: string | null = null;
  if (session) {
    label =
      session.kind === "indigenomics"
        ? "Indigenomics"
        : session.partyId
          ? ((await repo.getParty(session.partyId))?.name ?? session.partyId)
          : null;
  }

  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
      </head>
      <body className="min-h-screen">
        <header className="border-b border-line px-6 py-4 flex items-center justify-between">
          <a href="/" className="font-serif text-lg">
            Indigenomics <span className="text-amber italic">Data Portal</span>
          </a>
          <div className="flex items-center gap-4 text-xs">
            <span className="uppercase tracking-[0.18em] text-ink3">demo · synthetic data</span>
            <ThemeMenu />
            {session && (
              <a href="/home" className="text-ink2 hover:text-ink">
                Home
              </a>
            )}
            {label && (
              <span className="text-ink3">
                signed in as <span className="text-ink2">{label}</span>
              </span>
            )}
            {session && (
              <form action={signOut}>
                <button className="underline text-ink3 hover:text-ink">switch account</button>
              </form>
            )}
          </div>
        </header>
        <main className="px-6 py-10 max-w-5xl mx-auto">{children}</main>
      </body>
    </html>
  );
}
