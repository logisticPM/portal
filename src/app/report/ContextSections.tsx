// Read-only "context" sections of the company questionnaire (RAP framework sections A / C / D).
// Sourced from the 41-question RAP Impact Survey domain (src/lib/survey). These are
// self-report — they are displayed but NEVER confirmed and NEVER flow to coverage/Index.
// That split (confirmable lines vs. self-report context) is the product's moat, shown on screen.
import type { ReactNode } from "react";
import type { Industry, Organization, RapType, SurveyResponse } from "@/lib/survey";

// --- enum → human label maps (only the values the demo surfaces) ----------------
const industryLabels: Partial<Record<Industry, string>> = {
  finance_insurance: "Finance & insurance",
  consulting: "Consulting",
  construction: "Construction",
  mining: "Mining",
  transport: "Transport",
  retail: "Retail",
};

const rapTypeLabels: Record<RapType, string> = {
  reflect: "Reflect",
  innovate: "Innovate",
  stretch: "Stretch",
  elevate: "Elevate",
};

const governanceLabels: Record<string, string> = {
  internal_employee_group: "Internal employee group",
  external_advisory: "External advisory body",
  consulted: "Consulted on RAP",
  formal_evaluation: "Formal evaluation process",
  none: "None",
  other: "Other",
};

function humanIndustry(i: Industry): string {
  return industryLabels[i] ?? i.replace(/_/g, " & ");
}

// The stamp that marks every context block as self-report — the visual opposite of a
// confirmed line's tier badge.
function UnverifiedStamp() {
  return (
    <span className="text-[0.6rem] uppercase tracking-wider border border-ink3/40 text-ink3 rounded px-1.5 py-0.5">
      self-reported · unverified
    </span>
  );
}

function SectionHeader({ letter, title, stamped }: { letter: string; title: string; stamped?: boolean }) {
  return (
    <div className="flex items-center gap-3 mb-2">
      <span className="text-ink3 text-xs uppercase tracking-widest">
        {letter} · {title}
      </span>
      {stamped ? <UnverifiedStamp /> : null}
    </div>
  );
}

// A labelled value pair used across the context blocks.
function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <div className="text-ink3 text-[0.7rem] uppercase tracking-widest">{label}</div>
      <div className="text-ink2">{value}</div>
    </div>
  );
}

// --- Section A · Organisation profile ------------------------------------------
export function ProfileCard({ org }: { org: Organization }) {
  return (
    <section>
      <SectionHeader letter="A" title="Organisation profile" />
      <div className="bg-panel rounded border border-line shadow-card p-5 grid sm:grid-cols-3 gap-4">
        <Field label="Industry" value={humanIndustry(org.industry)} />
        <Field label="Latest RAP type" value={rapTypeLabels[org.latestRapType]} />
        <Field label="Employees" value={org.totalEmployees.toLocaleString("en-CA")} />
        <Field label="Listed (TSX 200)" value={org.asx200 ? "Yes" : "No"} />
        <Field label="Primary contact" value={org.contactName} />
        <Field label="Contact email" value={org.contactEmail} />
      </div>
    </section>
  );
}

// --- Sections C / D · self-report context --------------------------------------
export function ContextBlocks({ survey }: { survey: SurveyResponse }) {
  const staff = survey.indigenousStaff;
  const byLevel = survey.indigenousStaffByLevel;
  const cl = survey.culturalLearning;

  return (
    <div className="space-y-6">
      {/* C · Workforce & culture */}
      <section>
        <SectionHeader letter="C" title="Workforce & culture" stamped />
        <div className="bg-panel/60 rounded border border-line p-5 grid sm:grid-cols-3 gap-4">
          <Field
            label="Indigenous staff"
            value={staff.total === null ? "Not collected" : staff.total.toLocaleString("en-CA")}
          />
          <Field
            label="Senior exec / board"
            value={`${byLevel.seniorExec} exec · ${byLevel.board} board`}
          />
          <Field label="Mgmt / entry-level" value={`${byLevel.middleManagement} · ${byLevel.entryLevel}`} />
          <Field
            label="Cultural learning (hrs)"
            value={`${(cl.elearning + cl.faceToFace + cl.immersion).toLocaleString("en-CA")} total`}
          />
          <Field label="Cultural protocols doc" value={survey.hasCulturalProtocolsDoc ? "Yes" : "No"} />
          <Field label="Employment strategy" value={survey.hasEmploymentStrategy ? "Yes" : "No"} />
        </div>
      </section>

      {/* D · Governance & relationships */}
      <section>
        <SectionHeader letter="D" title="Governance & relationships" stamped />
        <div className="bg-panel/60 rounded border border-line p-5 grid sm:grid-cols-3 gap-4">
          <Field
            label="Governance structures"
            value={
              survey.governanceStructures.length
                ? survey.governanceStructures.map((g) => governanceLabels[g] ?? g).join(", ")
                : "None"
            }
          />
          <Field label="Senior-leader engagement" value={`${survey.seniorLeaderEngagement} / 5`} />
          <Field
            label="Partnerships"
            value={`${survey.partnerships.formal} formal · ${survey.partnerships.informal} informal`}
          />
          {survey.partneredWith.length ? (
            <div className="sm:col-span-3">
              <Field label="Partnered with" value={survey.partneredWith.join(", ")} />
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
