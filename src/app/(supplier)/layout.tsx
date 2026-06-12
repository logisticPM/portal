import { SupplierNav } from "@/components/SupplierNav";

// The supplier portal shell. Wraps confirm / record / register (route-group `(supplier)`
// keeps the URLs unchanged: /confirm, /record, /register). Nate's company pages and the
// Indigenomics analytics page are NOT in this group — they keep the bare root layout.
export default function SupplierLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <SupplierNav />
      {children}
    </div>
  );
}
