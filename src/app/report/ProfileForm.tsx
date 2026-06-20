"use client";

import { updateProfileAction } from "@/lib/survey/actions";
import type { Industry, Organization, RapType } from "@/lib/survey";

// Q2 industries (value → label). Ordered for the dropdown; "unspecified" is the
// blank placeholder and is not offered as a real choice.
const INDUSTRY_OPTIONS: { value: Industry; label: string }[] = [
  { value: "architecture", label: "Architecture" },
  { value: "arts_culture", label: "Arts & culture" },
  { value: "community_dev", label: "Community development" },
  { value: "construction", label: "Construction" },
  { value: "consulting", label: "Consulting" },
  { value: "education", label: "Education" },
  { value: "environment", label: "Environment" },
  { value: "finance_insurance", label: "Finance & insurance" },
  { value: "governance", label: "Governance" },
  { value: "health", label: "Health" },
  { value: "legal", label: "Legal" },
  { value: "marketing", label: "Marketing" },
  { value: "media", label: "Media" },
  { value: "mining", label: "Mining" },
  { value: "property", label: "Property" },
  { value: "recruitment", label: "Recruitment" },
  { value: "retail", label: "Retail" },
  { value: "safety_security", label: "Safety & security" },
  { value: "science_tech_eng", label: "Science, tech & engineering" },
  { value: "social_services", label: "Social services" },
  { value: "sport", label: "Sport" },
  { value: "tourism", label: "Tourism" },
  { value: "transport", label: "Transport" },
];

const RAP_OPTIONS: { value: RapType; label: string }[] = [
  { value: "reflect", label: "Reflect" },
  { value: "innovate", label: "Innovate" },
  { value: "stretch", label: "Stretch" },
  { value: "elevate", label: "Elevate" },
];

const inputCls = "w-full bg-bg border border-ink/15 rounded px-2 py-2";
const labelCls = "text-ink3 text-xs uppercase tracking-widest";

export function ProfileForm({
  companyId,
  orgId,
  org,
}: {
  companyId: string;
  orgId: string;
  org?: Organization;
}) {
  const industry: Industry = org?.industry ?? "unspecified";
  return (
    <section>
      <div className="flex items-center gap-3 mb-2">
        <span className={labelCls}>A · Organisation profile</span>
        <span className="text-ink3 text-xs">editing</span>
      </div>
      <form
        action={updateProfileAction}
        className="bg-panel rounded border border-line shadow-card p-5 space-y-4"
      >
        <input type="hidden" name="orgId" value={orgId} />
        <input type="hidden" name="companyId" value={companyId} />

        <div className="grid sm:grid-cols-3 gap-4">
          <label className="space-y-1">
            <span className={labelCls}>Industry</span>
            <select name="industry" defaultValue={industry} className={inputCls}>
              <option value="unspecified" disabled>
                Select an industry…
              </option>
              {INDUSTRY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className={labelCls}>Latest RAP type</span>
            <select name="latestRapType" defaultValue={org?.latestRapType ?? "reflect"} className={inputCls}>
              {RAP_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className={labelCls}>Employees</span>
            <input
              name="totalEmployees"
              type="number"
              min="0"
              step="1"
              defaultValue={org?.totalEmployees ?? 0}
              className={inputCls}
            />
          </label>

          <label className="flex items-center gap-2 text-ink2 text-sm">
            <input type="checkbox" name="asx200" value="true" defaultChecked={org?.asx200 ?? false} />
            Listed (TSX 200)
          </label>

          <label className="space-y-1">
            <span className={labelCls}>Primary contact</span>
            <input name="contactName" type="text" defaultValue={org?.contactName ?? ""} className={inputCls} />
          </label>

          <label className="space-y-1">
            <span className={labelCls}>Contact email</span>
            <input name="contactEmail" type="email" defaultValue={org?.contactEmail ?? ""} className={inputCls} />
          </label>
        </div>

        <div className="flex items-center gap-3">
          <button className="bg-amber/20 text-amber border border-amber/40 rounded px-4 py-2 hover:bg-amber/30">
            Save profile
          </button>
          <a className="text-ink3 underline text-sm" href={`/report?as=${companyId}`}>
            Cancel
          </a>
        </div>
      </form>
    </section>
  );
}
