import { InstituteNav } from "@/components/InstituteNav";
import { ExtractTabs } from "@/components/ExtractTabs";
import { UploadForm } from "./UploadForm";
import { ReviewPanel } from "./ReviewPanel";

export const dynamic = "force-dynamic";

export default async function ExtractPage({ searchParams }: { searchParams: { tab?: string } }) {
  const tab = searchParams.tab === "review" ? "review" : "upload";
  return (
    <div className="space-y-6">
      <InstituteNav active="/extract" />
      <ExtractTabs active={tab} />
      {tab === "upload" ? (
        <div>
          <h1 className="font-serif text-2xl mb-1">Submit a RAP for extraction</h1>
          <p className="text-ink2 text-sm mb-4">Upload a published RAP PDF; AI extracts commitments for review before they publish.</p>
          {/* Staff-only surface (INDIGENOMICS_ONLY in middleware), so the
              published-disclosure declaration is offered here and ONLY here —
              /my-rap renders this same component for companies, where the
              declaration is ignored by design (spec §6). */}
          <UploadForm allowPublicDeclaration />
        </div>
      ) : (
        <ReviewPanel />
      )}
    </div>
  );
}
