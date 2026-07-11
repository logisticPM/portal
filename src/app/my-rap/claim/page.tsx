// Company self-service: claim your organization by Business Number so you can
// later post RAP progress against it (recordRapProgressAction gates on this
// claim). Company-only (middleware + this page-level gate, mirroring
// src/app/my-commitments/page.tsx).
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ClaimForm } from "./ClaimForm";

export const dynamic = "force-dynamic";

export default function ClaimOrgPage() {
  const session = getSession();
  if (session?.kind !== "company" || !session.partyId) redirect("/home");

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div>
        <div className="text-amber text-xs uppercase tracking-widest mb-1">Company portal</div>
        <h1 className="font-serif text-3xl">Claim your organization</h1>
        <p className="text-ink2 text-sm mt-1">
          Enter your organization&apos;s federal Business Number (BN) to claim it. Once
          verified against the registry, you&apos;ll be able to post progress against its
          RAP commitments.
        </p>
      </div>
      <ClaimForm />
    </div>
  );
}
