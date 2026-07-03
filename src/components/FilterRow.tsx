// A filter row: fixed-width category label on the left, wrapping chips on the
// right. Two columns so wrapped chips align under the first chip (not under the
// label), and every row's label + options line up.
export function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 items-start text-xs">
      <span className="text-ink3 uppercase tracking-widest w-20 shrink-0 pt-1">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}
