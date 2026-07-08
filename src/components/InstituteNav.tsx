// Shared sub-nav for the three Indigenomics (institute) pages, so they link to
// each other. Pass the current route as `active`.
const TABS = [
  { href: "/commitments", label: "RAP Index" },
  { href: "/organizations", label: "Organizations" },
  { href: "/suppliers", label: "Suppliers" },
  { href: "/analytics", label: "Coverage analysis" },
  { href: "/verify", label: "Verification" },
  { href: "/alignment", label: "Alignment" },
  { href: "/extract", label: "Extract" },
];

export function InstituteNav({ active }: { active: string }) {
  return (
    <nav className="flex flex-wrap items-center gap-1 border-b border-line pb-3">
      <span className="text-amber text-xs uppercase tracking-widest mr-3">Indigenomics</span>
      {TABS.map((t) => (
        <a
          key={t.href}
          href={t.href}
          className={`text-sm rounded px-3 py-1 ${
            t.href === active ? "bg-amber/10 text-amber" : "text-ink2 hover:text-ink"
          }`}
        >
          {t.label}
        </a>
      ))}
    </nav>
  );
}
