import Link from "next/link";

const TABS = [
  { key: "upload", label: "Upload" },
  { key: "review", label: "Review queue" },
] as const;

export function ExtractTabs({ active }: { active: "upload" | "review" }) {
  return (
    <div className="flex items-center gap-1 border-b border-line pb-3">
      <span className="text-amber text-xs uppercase tracking-widest mr-3">Extraction</span>
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={`/extract?tab=${t.key}`}
          className={`text-sm rounded px-3 py-1 ${
            t.key === active ? "bg-amber/10 text-amber" : "text-ink2 hover:text-ink"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
