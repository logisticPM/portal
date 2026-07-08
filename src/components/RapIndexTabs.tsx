import Link from "next/link";

const TABS = [
  { key: "table", href: "/commitments", label: "Table" },
  { key: "explore", href: "/commitments/explore", label: "Explore" },
] as const;

export function RapIndexTabs({ active }: { active: "table" | "explore" }) {
  return (
    <div className="flex items-center gap-1 -mt-2">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={`text-sm rounded px-3 py-1 ${
            t.key === active ? "bg-cedar/10 text-cedar" : "text-ink2 hover:text-ink"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
