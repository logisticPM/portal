"use client";

// Client-side, batched review of a job's flagged fields (design:
// 2026-08-01-review-field-edit-verify). Holds the reviewer's edits and
// check-offs in local state; one "Save & publish" commits everything through
// confirmReviewedExtractionAction. Kept a client component (the rest of the
// review card is server-rendered) because editing several fields one
// server-reload-at-a-time would be unusable — the whole point is a smooth pass.
//
// Field descriptors are built server-side (field-edit.ts) and arrive as plain
// data, so this component renders controls without importing taxonomy/publish logic.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmReviewedExtractionAction, openSourceAction } from "@/lib/rap/actions";
import type { EditableField } from "@/lib/rap/field-edit";
import { InfoTip } from "@/components/InfoTip";
import { MARKER_HELP, RULE_HELP } from "@/lib/rap/validation-display";

export interface FieldGroupView {
  rule: string;
  label: string;
  hint: string | null;
  fields: EditableField[];
}

export function FlaggedFieldsEditor({
  jobId,
  needsBn,
  groups,
}: {
  jobId: string;
  needsBn: boolean;
  groups: FieldGroupView[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // editPath -> new value (only fields the reviewer changed)
  const [edits, setEdits] = useState<Record<string, unknown>>({});
  // flagged paths the reviewer has checked off
  const [verified, setVerified] = useState<Record<string, boolean>>({});

  const allFields = groups.flatMap((g) => g.fields);
  const verifiedCount = allFields.filter((f) => verified[f.path]).length;
  // Empty ⇒ nothing to verify (document-level-only flag): publishable once the BN
  // is set. every() on [] is true, which is exactly right here.
  const allVerified = allFields.every((f) => verified[f.path]);
  const canSave = allVerified && !needsBn && !pending;

  const setEdit = (editPath: string, value: unknown) => setEdits((e) => ({ ...e, [editPath]: value }));

  const save = () => {
    setError(null);
    const payload = {
      jobId,
      edits: Object.entries(edits).map(([path, value]) => ({ path, value })),
      verifiedFields: allFields.filter((f) => verified[f.path]).map((f) => f.path),
    };
    startTransition(async () => {
      const res = await confirmReviewedExtractionAction(payload);
      if (res?.ok) router.refresh();
      else setError(res?.error ?? "Could not publish — try again.");
    });
  };

  return (
    <div className="space-y-3">
      {groups.map((g) => {
        const ruleTip = RULE_HELP[g.rule as keyof typeof RULE_HELP];
        return (
        <div key={g.rule}>
          <div className="text-ink2 mb-1">
            {ruleTip ? (
              <InfoTip tip={ruleTip} label={g.label}>
                <span className="font-medium">{g.label}</span>
              </InfoTip>
            ) : (
              <span className="font-medium">{g.label}</span>
            )}{" "}
            — {g.fields.length} {g.fields.length === 1 ? "field" : "fields"}
          </div>
          {g.hint && <div className="text-ink3 text-xs mb-2">{g.hint}</div>}
          <div className="space-y-2">
            {g.fields.map((f) => (
              <FieldCard
                key={f.path}
                field={f}
                jobId={jobId}
                edited={f.editPath in edits}
                onEdit={(v) => setEdit(f.editPath, v)}
                checked={!!verified[f.path]}
                onToggle={() => setVerified((v) => ({ ...v, [f.path]: !v[f.path] }))}
              />
            ))}
          </div>
        </div>
        );
      })}

      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={save}
          disabled={!canSave}
          className="px-4 py-2 rounded bg-cedar text-white text-sm disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {pending ? "Publishing…" : "Save & publish"}
        </button>
        <span className="text-ink3 text-xs">
          {needsBn
            ? "Resolve the Business Number below first."
            : allFields.length === 0
              ? "No fields to verify — review the document note above."
              : `${verifiedCount} of ${allFields.length} fields verified${allVerified ? "" : " — verify all to publish"}`}
        </span>
      </div>
      {error && <div className="text-rust text-xs">{error}</div>}
    </div>
  );
}

function FieldCard({
  field,
  jobId,
  edited,
  onEdit,
  checked,
  onToggle,
}: {
  field: EditableField;
  jobId: string;
  edited: boolean;
  onEdit: (value: unknown) => void;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={`rounded border p-2 ${checked ? "border-cedar/40 bg-cedar/5" : "border-line bg-panel/60"}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-ink3 text-[11px] uppercase tracking-wide">
          {field.control === "period" ? (
            <InfoTip tip={MARKER_HELP.periodCovered} label={field.label}>
              <span>{field.label}</span>
            </InfoTip>
          ) : (
            field.label
          )}
        </div>
        <label className="text-ink3 text-xs flex items-center gap-1 shrink-0 cursor-pointer">
          <input type="checkbox" checked={checked} onChange={onToggle} />
          Verified
        </label>
      </div>

      <div className="text-sm mt-1">
        <span className="text-ink3">AI read this as:</span> {field.displayValue}
        {edited && <span className="ml-2 text-cedar text-xs">· edited</span>}
      </div>

      <div className="mt-1">
        <EditControl field={field} onEdit={onEdit} />
      </div>

      {field.quote ? (
        <div className="text-ink3 text-xs mt-1">
          {field.rule === "quote_not_found" ? "Cited (couldn't match): " : "Cited: "}“{field.quote}”{field.page ? ` · p.${field.page}` : ""}
        </div>
      ) : (
        <div className="text-rust text-xs mt-1">
          <InfoTip tip={MARKER_HELP.noSourceSpan} label="No source quote given">
            <span>No source quote given — locate this in the document.</span>
          </InfoTip>
        </div>
      )}

      {field.page != null && (
        <form action={openSourceAction} target="_blank" className="mt-1">
          <input type="hidden" name="jobId" value={jobId} />
          <input type="hidden" name="page" value={field.page} />
          <button className="text-cedar text-xs underline">Open source PDF at p.{field.page} ↗</button>
        </form>
      )}
    </div>
  );
}

// Field-type-aware editor. Enum values can only ever be canonical (dropdown /
// checkboxes), so an edit can never fall out of the allowed set.
function EditControl({ field, onEdit }: { field: EditableField; onEdit: (value: unknown) => void }) {
  const cls = "px-2 py-1 rounded border border-line text-sm w-full max-w-xl";

  if (field.control === "enum") {
    return (
      <select
        defaultValue={typeof field.currentValue === "string" ? field.currentValue : ""}
        onChange={(e) => onEdit(e.target.value)}
        className={cls}
      >
        <option value="">— choose —</option>
        {field.options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }

  if (field.control === "enum-multi") {
    return <MultiEnumControl field={field} onEdit={onEdit} />;
  }

  if (field.control === "period") {
    return <PeriodControl field={field} onEdit={onEdit} />;
  }

  // free text
  return (
    <textarea
      defaultValue={typeof field.currentValue === "string" ? field.currentValue : ""}
      onChange={(e) => onEdit(e.target.value)}
      rows={2}
      className={cls}
    />
  );
}

// Multi-select needs its own state: the accumulated selection can't be
// recomputed from props on every keystroke (the field prop never changes), or a
// second toggle would discard the first.
function MultiEnumControl({ field, onEdit }: { field: EditableField; onEdit: (value: unknown) => void }) {
  const [selected, setSelected] = useState<string[]>(
    Array.isArray(field.currentValue) ? (field.currentValue as string[]) : [],
  );
  const toggle = (value: string, on: boolean) => {
    const next = on ? [...selected, value] : selected.filter((v) => v !== value);
    setSelected(next);
    onEdit(next);
  };
  return (
    <div className="flex flex-col gap-1">
      {field.options?.map((o) => (
        <label key={o.value} className="text-sm flex items-center gap-2">
          <input type="checkbox" checked={selected.includes(o.value)} onChange={(e) => toggle(o.value, e.target.checked)} />
          {o.label}
        </label>
      ))}
    </div>
  );
}

// Two inputs, one value: tracked together in state so editing end doesn't reset
// start back to the AI's original.
function PeriodControl({ field, onEdit }: { field: EditableField; onEdit: (value: unknown) => void }) {
  const v = (field.currentValue ?? {}) as { start?: string; end?: string };
  const [period, setPeriod] = useState({ start: v.start ?? "", end: v.end ?? "" });
  const set = (patch: Partial<typeof period>) => {
    const next = { ...period, ...patch };
    setPeriod(next);
    onEdit(next);
  };
  return (
    <div className="flex gap-2 items-center text-sm">
      <input value={period.start} placeholder="start" onChange={(e) => set({ start: e.target.value })} className="px-2 py-1 rounded border border-line w-32" />
      <span className="text-ink3">→</span>
      <input value={period.end} placeholder="end" onChange={(e) => set({ end: e.target.value })} className="px-2 py-1 rounded border border-line w-32" />
    </div>
  );
}
