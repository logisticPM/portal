import { InstituteNav } from "@/components/InstituteNav";
import { RapIndexTabs } from "@/components/RapIndexTabs";
import { getIndexFacts } from "@/lib/rap-index/facts-source";
import { ExploreClient } from "./ExploreClient";

export const dynamic = "force-dynamic";

export default async function CommitmentsExplorePage() {
  const facts = await getIndexFacts();
  return (
    <div className="space-y-6">
      <InstituteNav active="/commitments" />
      <RapIndexTabs active="explore" />
      <ExploreClient facts={facts} />
    </div>
  );
}
