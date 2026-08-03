// Per-field editing for the review queue (design: 2026-08-01-review-field-edit-verify).
//
// A reviewer can correct a flagged field before publishing. The hazard is the
// controlled-vocabulary fields: DynamoDB enforces nothing and publish.ts's
// oneOf() silently coerces any out-of-set value to "other". So each field maps to
// a CONTROL that constrains what can be entered — a dropdown of the canonical
// values for enums, a text box for free text — making an invalid edit impossible
// rather than silently downgraded.
//
// This module is pure (no React, no I/O): the server builds serializable
// descriptors for the client to render, and applyFieldEdits() writes a reviewer's
// edits back onto an ExtractedRap before publish. Tests: scripts/test-review-field-edit.ts.
import type { ExtractedRap } from "./types";
import { COMMITMENT_TYPES, FRAMEWORK_REFS, JURISDICTIONS, PAIR_LEVELS, PILLARS, RAP_TYPES, SECTORS } from "./extraction-schema";
import { FRAMEWORK_LABELS, isGrounded, pathToField } from "./validation-display";
import { labelFor } from "../taxonomy";

export type ControlKind = "text" | "enum" | "enum-multi" | "period";

interface Control {
  control: ControlKind;
  options?: readonly string[]; // enum / enum-multi choices
  editKey?: string; // when the edit writes a DIFFERENT key than the flagged one
}

// Everything not listed here is free text. Note pillarRaw (the flagged path, the
// document's verbatim wording) edits pillarNormalized (the canonical value that
// actually publishes and drives Explore) — pillarRaw stays as read-only evidence.
const CONTROLS: Record<string, Control> = {
  sector: { control: "enum", options: SECTORS },
  commitmentType: { control: "enum", options: COMMITMENT_TYPES },
  jurisdiction: { control: "enum", options: JURISDICTIONS },
  rapType: { control: "enum", options: RAP_TYPES },
  pairLevel: { control: "enum", options: PAIR_LEVELS },
  pillarRaw: { control: "enum", options: PILLARS, editKey: "pillarNormalized" },
  frameworkRefs: { control: "enum-multi", options: FRAMEWORK_REFS },
  periodCovered: { control: "period" },
};

export function controlForKey(key: string): Control {
  return CONTROLS[key] ?? { control: "text" };
}

const JURIS_LABELS: Record<string, string> = { AU: "Australia (AU)", CA: "Canada (CA)", other: "Other" };

// Human label for an enum option. Frameworks/jurisdictions get curated labels;
// sector/commitmentType route through labelFor's curated maps; pillar/rapType/
// pairLevel fall through labelFor to its humanize() (e.g. "reflect" → "Reflect").
function optionLabel(key: string, value: string): string {
  if (key === "frameworkRefs") return FRAMEWORK_LABELS[value] ?? value;
  if (key === "jurisdiction") return JURIS_LABELS[value] ?? value;
  return labelFor(key, value);
}

const COMMITMENT_PATH = /^commitments\[(\d+)\]\.(\w+)$/;

function splitPath(path: string): { index: number | null; key: string } {
  const m = COMMITMENT_PATH.exec(path);
  return m ? { index: Number(m[1]), key: m[2] } : { index: null, key: path };
}

function containerFor(extracted: ExtractedRap, index: number | null): Record<string, unknown> | undefined {
  return (index === null ? (extracted as unknown as Record<string, unknown>) : (extracted.commitments[index] as unknown as Record<string, unknown> | undefined));
}

// Read the editable value at a path: a Grounded field's .value, or a plain scalar
// (pillarNormalized). Returns null when the path doesn't resolve.
export function readValueAt(extracted: ExtractedRap, path: string): unknown {
  const { index, key } = splitPath(path);
  const container = containerFor(extracted, index);
  const target = container?.[key];
  if (target === undefined) return null;
  return isGrounded(target) ? target.value : target;
}

export interface EditableField {
  path: string; // the flagged path — the verify key and card identity
  editPath: string; // where an edit writes (== path, except pillarRaw → pillarNormalized)
  control: ControlKind;
  options?: { value: string; label: string }[]; // for enum / enum-multi
  currentValue: unknown; // pre-fills the control (string | string[] | {start,end} | null)
  label: string; // "Commitment 1 · Pillar"
  displayValue: string; // human-readable current value (from validation-display)
  quote: string | null;
  page: number | null;
  rule: string; // the validation rule (for evidence framing)
}

// Build the serializable descriptor the client renders for one flagged field.
// Returns null for unresolvable paths (e.g. $document) — those aren't editable.
export function editableField(extracted: ExtractedRap, path: string, rule: string): EditableField | null {
  const resolved = pathToField(extracted, path);
  if (!resolved) return null;
  const { index, key } = splitPath(path);
  const ctl = controlForKey(key);
  const editKey = ctl.editKey ?? key;
  const editPath = index === null ? editKey : `commitments[${index}].${editKey}`;
  const options = ctl.options?.map((v) => ({ value: v, label: optionLabel(key, v) }));
  return {
    path,
    editPath,
    control: ctl.control,
    options,
    currentValue: readValueAt(extracted, editPath),
    label: resolved.label,
    displayValue: resolved.displayValue,
    quote: resolved.g.quote,
    page: resolved.page,
    rule,
  };
}

export interface FieldEdit {
  path: string; // an editPath from a descriptor
  value: unknown;
}

// Apply a reviewer's edits to a copy of the extraction before publish. Grounded
// targets get their .value replaced; plain scalars (pillarNormalized) are set
// directly. Unknown paths are no-ops. Pure — does not mutate the input.
export function applyFieldEdits(extracted: ExtractedRap, edits: FieldEdit[]): ExtractedRap {
  const copy: ExtractedRap = JSON.parse(JSON.stringify(extracted));
  for (const { path, value } of edits) {
    const { index, key } = splitPath(path);
    const container = containerFor(copy, index);
    if (!container || !(key in container)) continue;
    const target = container[key];
    if (isGrounded(target)) target.value = value;
    else container[key] = value;
  }
  return copy;
}
