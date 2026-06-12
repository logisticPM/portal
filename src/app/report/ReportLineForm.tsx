"use client";

import { useState } from "react";
import { createLineAction } from "@/lib/repo/actions";
import type { IdentityTier, Party } from "@/lib/repo/types";

const tierLabels: Record<IdentityTier, string> = {
  nation: "Nation-verified",
  ccab: "CCAB-certified",
  self_declared: "Self-declared",
};

// The two confirmable FLOW TYPES. procurement = company buys FROM an Indigenous supplier
// (RAP core, MVP); capital = company invests equity INTO an Indigenous business (ownership
// frontier). Equity is NOT a flow here — it's the supplier's ownership cert (their tier);
// innovation is a TAG (checkbox below). See docs/sprint2/04_Pillar_Model_Proposal.
type FlowType = "procurement" | "capital";

// Each flow relabels the amount field and the counterparty it names.
const flowConfig: Record<
  FlowType,
  { amountLabel: string; counterparty: string; hint: string }
> = {
  procurement: {
    amountLabel: "Amount paid (CAD)",
    counterparty: "Supplier",
    hint: "A procurement line — what you paid a named Indigenous supplier, confirmable by them.",
  },
  capital: {
    amountLabel: "Equity invested (CAD)",
    counterparty: "Indigenous business",
    hint: "A capital line — equity you invested INTO a named Indigenous business, confirmable by them. (Ownership frontier — beyond standard RAP.)",
  },
};

export function ReportLineForm({
  companyId,
  suppliers,
}: {
  companyId: string;
  suppliers: Party[];
}) {
  const [flowType, setFlowType] = useState<FlowType>("procurement");
  const config = flowConfig[flowType];

  return (
    <form
      action={createLineAction}
      className="bg-panel rounded border border-line shadow-card p-5 space-y-4"
    >
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="flowType" value={flowType} />

      <div className="grid sm:grid-cols-[8rem_1fr_10rem_8rem] gap-3">
        <label className="space-y-1">
          <span className="text-ink3 text-xs uppercase tracking-widest">Flow</span>
          <select
            value={flowType}
            onChange={(e) => setFlowType(e.target.value as FlowType)}
            className="w-full bg-bg border border-ink/15 rounded px-2 py-2"
          >
            <option value="procurement">procurement</option>
            <option value="capital">capital</option>
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

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-ink2 text-sm">
          <input type="checkbox" name="tags" value="innovation" />
          Innovation / R&amp;D
        </label>
        <button className="bg-amber/20 text-amber border border-amber/40 rounded px-4 py-2 hover:bg-amber/30">
          Report line
        </button>
        <span className="text-ink3 text-sm">{config.hint}</span>
      </div>
    </form>
  );
}
