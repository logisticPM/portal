// CSV export of the (optionally filtered) RAP commitments — so the institute can
// pull the data into a spreadsheet / report. Honors ?sector= and ?type=.
import { commitmentsRepo } from "@/lib/commitments";
import type { CommitmentType, Sector } from "@/lib/commitments";

export const dynamic = "force-dynamic";

const COLUMNS = [
  "id",
  "organization",
  "sector",
  "orgSize",
  "type",
  "title",
  "targetYear",
  "rapType",
  "status",
  "progressPct",
] as const;

// RFC-4180-ish escaping: quote fields containing comma, quote, or newline.
function esc(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sector = (searchParams.get("sector") as Sector | null) ?? undefined;
  const type = (searchParams.get("type") as CommitmentType | null) ?? undefined;

  const list = await commitmentsRepo.listCommitments({ sector, type });
  const rows = list.map((c) =>
    [c.id, c.orgName, c.sector, c.orgSize, c.type, c.title, c.targetYear, c.rapType ?? "", c.status, c.progressPct]
      .map(esc)
      .join(","),
  );
  const csv = [COLUMNS.join(","), ...rows].join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="rap-index.csv"',
      "Cache-Control": "no-store",
    },
  });
}
