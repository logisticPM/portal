import { repo } from "@/lib/repo";
import { getSession } from "@/lib/auth";
import type { NextRequest } from "next/server";

// OCAP "Access": a party downloads everything about them.
export async function GET(req: NextRequest) {
  const partyId = req.nextUrl.searchParams.get("party");
  if (!partyId) {
    return new Response("missing ?party", { status: 400 });
  }
  const session = getSession();
  if (!session) return new Response("unauthorized", { status: 401 });
  if (session.kind !== "indigenomics" && session.partyId !== partyId) {
    return new Response("forbidden", { status: 403 });
  }
  const bundle = await repo.exportRecords(partyId);
  return new Response(JSON.stringify(bundle, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="export-${partyId}.json"`,
    },
  });
}
