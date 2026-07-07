// RAP Index — exploratory dashboard (Idea 2, Option A read model). The server
// materializes the whole corpus into ONE flat fact table (via the existing
// rapRepo — mock or dynamo) and ships it to the browser; ExploreClient then does
// every pivot / drill-down / graph in-memory. See docs/rap-dashboard-architecture.md.
import Link from "next/link";
import { rapRepo } from "@/lib/rap";
import type { Sector } from "@/lib/rap";
import { buildFacts } from "@/lib/rap/analytics";
import { ExploreClient } from "@/app/commitments/explore/ExploreClient";

export const dynamic = "force-dynamic";

const SECTORS: Sector[] = [
  "mining_extractive", "finance_banking", "telecom", "energy",
  "government", "retail", "transport", "other",
];

export default async function RapExplorePage() {
  // gather every commitment via the per-sector slices (repo-agnostic)
  const perSector = await Promise.all(SECTORS.map((s) => rapRepo.listCommitmentsBySector(s)));
  const commitments = perSector.flat();

  // fetch the orgs, RAPs and rollups the facts reference
  const orgIds = [...new Set(commitments.map((c) => c.orgId))];
  const rapIds = [...new Set(commitments.map((c) => c.rapId))];
  const [orgs, raps, rollups] = await Promise.all([
    Promise.all(orgIds.map((id) => rapRepo.getOrganization(id))),
    Promise.all(rapIds.map((id) => rapRepo.getRap(id))),
    Promise.all(commitments.map((c) => rapRepo.getRollup(c.id))),
  ]);

  const orgById = new Map(orgs.filter(Boolean).map((o) => [o!.id, o!]));
  const rapById = new Map(raps.filter(Boolean).map((r) => [r!.id, r!]));
  const rollupById = new Map(rollups.filter(Boolean).map((r) => [r!.commitId, r!]));

  const facts = buildFacts(commitments, orgById, rapById, rollupById);

  return (
    // Break out of the layout's max-w-5xl and use the full viewport width — the
    // treemap / graph views need the room. Other pages keep the narrow column.
    <div className="relative left-1/2 -translate-x-1/2 w-[100vw] px-6 space-y-6">
      <div className="max-w-[1600px] mx-auto space-y-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="text-amber text-xs uppercase tracking-widest mb-1">Indigenomics · RAP Index</div>
            <h1 className="font-serif text-3xl">
              Explore the commitments <span className="text-ink3 text-base">— slice any dimension, live</span>
            </h1>
            <p className="text-ink3 text-sm mt-1 max-w-3xl">
              One dataset, shipped to your browser. Every pivot, drill-down and relationship below is computed
              client-side — no query round-trip. Pick a dimension and a measure, then click anything to drill in.
            </p>
          </div>
          <div className="flex gap-3 text-sm shrink-0">
            <Link href="/rap" className="px-3 py-2 rounded border border-line">← Overview</Link>
            <Link href="/rap/upload" className="px-3 py-2 rounded bg-amber text-white">Upload a RAP</Link>
          </div>
        </div>

        <ExploreClient facts={facts} />
      </div>
    </div>
  );
}
