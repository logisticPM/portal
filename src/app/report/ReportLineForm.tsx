"use client";

import { useState } from "react";
import { createLineAction } from "@/lib/repo/actions";
import type { IdentityTier, Party } from "@/lib/repo/types";

const tierLabels: Record<IdentityTier, string> = {
  nation: "Nation-verified",
  ccab: "CCAB-certified",
  self_declared: "Self-declared",
};

// The two confirmable pillars in demo scope. procurement = MVP flagship,
// equity = the high-value second (the phantom-JV fraud signal the Index surfaces).
// capital/innovation remain Horizon 2 (see docs/sprint2/02_Questionnaire_Expansion_Design §4).
type ReportablePillar = "procurement" | "equity";

// Each pillar relabels the amount field and the supplier role it names.
const pillarConfig: Record<
  ReportablePillar,
  { amountLabel: string; counterparty: string; hint: string }
> = {
  procurement: {
    amountLabel: "Amount paid (CAD)",
    counterparty: "Supplier",
    hint: "A procurement line — what you paid a named Indigenous supplier, confirmable by them.",
  },
  equity: {
    amountLabel: "Equity value / stake (CAD)",
    counterparty: "Indigenous partner",
    hint: "An equity / JV stake held with a named Indigenous partner — confirmable by them. A self-declared stake is the phantom-JV signal the Index flags.",
  },
};

export function ReportLineForm({
  companyId,
  suppliers,
}: {
  companyId: string;
  suppliers: Party[];
}) {
  const [pillar, setPillar] = useState<ReportablePillar>("procurement");
  const config = pillarConfig[pillar];

  return (
    <form
      action={createLineAction}
      className="bg-panel rounded border border-line shadow-card p-5 space-y-4"
    >
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="pillar" value={pillar} />

      <div className="grid sm:grid-cols-[8rem_1fr_10rem_8rem] gap-3">
        <label className="space-y-1">
          <span className="text-ink3 text-xs uppercase tracking-widest">Pillar</span>
          <select
            value={pillar}
            onChange={(e) => setPillar(e.target.value as ReportablePillar)}
            className="w-full bg-bg border border-ink/15 rounded px-2 py-2"
          >
            <option value="procurement">procurement</option>
            <option value="equity">equity</option>
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-ink3 text-xs uppercase tracking-widest">
            {config.counterparty}
          </span>
          <select
            name="supplierId"
            required
            defaultValue=""
            className="w-full bg-bg border border-ink/15 rounded px-2 py-2"
          >
            <option value="" disabled>
              Select a {config.counterparty.toLowerCase()}…
            </option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.role === "supplier" ? ` — ${tierLabels[s.identityTier]}` : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-ink3 text-xs uppercase tracking-widest">
            {config.amountLabel}
          </span>
          <input
            name="amount"
            type="number"
            min="1"
            step="1"
            required
            placeholder="e.g. 250000"
            className="w-full bg-bg border border-ink/15 rounded px-2 py-2"
          />
        </label>

        <label className="space-y-1">
          <span className="text-ink3 text-xs uppercase tracking-widest">Period</span>
          <input
            name="period"
            type="text"
            required
            defaultValue="2025"
            className="w-full bg-bg border border-ink/15 rounded px-2 py-2"
          />
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button className="bg-amber/20 text-amber border border-amber/40 rounded px-4 py-2 hover:bg-amber/30">
          Report line
        </button>
        <span className="text-ink3 text-sm">{config.hint}</span>
      </div>
    </form>
  );
}
