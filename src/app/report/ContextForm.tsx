"use client";

import { updateContextAction } from "@/lib/survey/actions";
import type { GovernanceStructure, SurveyResponse } from "@/lib/survey";

const GOVERNANCE_OPTIONS: { value: GovernanceStructure; label: string }[] = [
  { value: "internal_employee_group", label: "Internal employee group" },
  { value: "external_advisory", label: "External advisory body" },
  { value: "consulted", label: "Consulted on RAP" },
  { value: "formal_evaluation", label: "Formal evaluation process" },
  { value: "other", label: "Other" },
];

const inputCls = "w-full bg-bg border border-ink/15 rounded px-2 py-2";
const labelCls = "text-ink3 text-xs uppercase tracking-widest";

export function ContextForm({
  companyId,
  orgId,
  year,
  survey,
}: {
  companyId: string;
  orgId: string;
  year: string;
  survey?: SurveyResponse;
}) {
  const byLevel = survey?.indigenousStaffByLevel;
  const cl = survey?.culturalLearning;
  const selectedGov = new Set(survey?.governanceStructures ?? []);
  const staffTotal = survey?.indigenousStaff.total ?? null;

  return (
    <div className="space-y-6">
      <form
        action={updateContextAction}
        className="bg-panel/60 rounded border border-line p-5 space-y-6"
      >
        <input type="hidden" name="orgId" value={orgId} />
        <input type="hidden" name="companyId" value={companyId} />
        <input type="hidden" name="year" value={year} />

        {/* C · Workforce & culture */}
        <div>
          <div className="flex items-center gap-3 mb-2">
            <span className={labelCls}>C · Workforce & culture</span>
            <span className="text-[0.6rem] uppercase tracking-wider border border-ink3/40 text-ink3 rounded px-1.5 py-0.5">
              self-reported · unverified
            </span>
          </div>
          <div className="grid sm:grid-cols-3 gap-4">
            <label className="space-y-1">
              <span className={labelCls}>Indigenous staff (total)</span>
              <input
                name="staffTotal"
                type="number"
                min="0"
                step="1"
                defaultValue={staffTotal ?? ""}
                className={inputCls}
              />
            </label>
            <label className="flex items-center gap-2 text-ink2 text-sm">
              <input type="checkbox" name="staffNotCollected" value="true" defaultChecked={staffTotal === null} />
              We do not collect this
            </label>
            <div />

            <label className="space-y-1">
              <span className={labelCls}>Board</span>
              <input name="board" type="number" min="0" step="1" defaultValue={byLevel?.board ?? 0} className={inputCls} />
            </label>
            <label className="space-y-1">
              <span className={labelCls}>Senior exec</span>
              <input name="seniorExec" type="number" min="0" step="1" defaultValue={byLevel?.seniorExec ?? 0} className={inputCls} />
            </label>
            <label className="space-y-1">
              <span className={labelCls}>Middle management</span>
              <input name="middleManagement" type="number" min="0" step="1" defaultValue={byLevel?.middleManagement ?? 0} className={inputCls} />
            </label>
            <label className="space-y-1">
              <span className={labelCls}>Entry level</span>
              <input name="entryLevel" type="number" min="0" step="1" defaultValue={byLevel?.entryLevel ?? 0} className={inputCls} />
            </label>

            <label className="space-y-1">
              <span className={labelCls}>Cultural learning — e-learning (hrs)</span>
              <input name="clElearning" type="number" min="0" step="1" defaultValue={cl?.elearning ?? 0} className={inputCls} />
            </label>
            <label className="space-y-1">
              <span className={labelCls}>Face-to-face (hrs)</span>
              <input name="clFaceToFace" type="number" min="0" step="1" defaultValue={cl?.faceToFace ?? 0} className={inputCls} />
            </label>
            <label className="space-y-1">
              <span className={labelCls}>Immersion (hrs)</span>
              <input name="clImmersion" type="number" min="0" step="1" defaultValue={cl?.immersion ?? 0} className={inputCls} />
            </label>

            <label className="flex items-center gap-2 text-ink2 text-sm">
              <input type="checkbox" name="hasCulturalProtocolsDoc" value="true" defaultChecked={survey?.hasCulturalProtocolsDoc ?? false} />
              Cultural protocols doc
            </label>
            <label className="flex items-center gap-2 text-ink2 text-sm">
              <input type="checkbox" name="hasEmploymentStrategy" value="true" defaultChecked={survey?.hasEmploymentStrategy ?? false} />
              Employment strategy
            </label>
          </div>
        </div>

        {/* D · Governance & relationships */}
        <div>
          <div className="flex items-center gap-3 mb-2">
            <span className={labelCls}>D · Governance & relationships</span>
            <span className="text-[0.6rem] uppercase tracking-wider border border-ink3/40 text-ink3 rounded px-1.5 py-0.5">
              self-reported · unverified
            </span>
          </div>
          <div className="grid sm:grid-cols-3 gap-4">
            <fieldset className="sm:col-span-3 space-y-1">
              <legend className={labelCls}>Governance structures</legend>
              <div className="flex flex-wrap gap-3">
                {GOVERNANCE_OPTIONS.map((o) => (
                  <label key={o.value} className="flex items-center gap-2 text-ink2 text-sm">
                    <input
                      type="checkbox"
                      name="governanceStructures"
                      value={o.value}
                      defaultChecked={selectedGov.has(o.value)}
                    />
                    {o.label}
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="space-y-1">
              <span className={labelCls}>Senior-leader engagement (1–5)</span>
              <select name="seniorLeaderEngagement" defaultValue={String(survey?.seniorLeaderEngagement ?? 1)} className={inputCls}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className={labelCls}>Partnerships — formal</span>
              <input name="partnershipsFormal" type="number" min="0" step="1" defaultValue={survey?.partnerships.formal ?? 0} className={inputCls} />
            </label>
            <label className="space-y-1">
              <span className={labelCls}>Partnerships — informal</span>
              <input name="partnershipsInformal" type="number" min="0" step="1" defaultValue={survey?.partnerships.informal ?? 0} className={inputCls} />
            </label>

            <label className="sm:col-span-3 space-y-1">
              <span className={labelCls}>Partnered with (comma-separated)</span>
              <input
                name="partneredWith"
                type="text"
                defaultValue={(survey?.partneredWith ?? []).join(", ")}
                placeholder="Supply Nation, CareerTrackers, Jawun"
                className={inputCls}
              />
            </label>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button className="bg-amber/20 text-amber border border-amber/40 rounded px-4 py-2 hover:bg-amber/30">
            Save context
          </button>
          <a className="text-ink3 underline text-sm" href={`/report?as=${companyId}`}>
            Cancel
          </a>
        </div>
      </form>
    </div>
  );
}
