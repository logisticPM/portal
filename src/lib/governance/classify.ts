import type { DataClass } from "./types";

export interface ClassifyUploadInput {
  // The uploading session's kind. null ⇒ unauthenticated/unknown.
  sessionKind: "indigenomics" | "company" | null;
  // Staff-only: an explicit assertion that this document is a published
  // disclosure. Ignored for company sessions (a company must not be able to
  // declare its own submission public — the greenwashing incentive).
  declaredPublic?: boolean;
}

// The single classification decision, at ingestion (spec §6). Conservative by
// construction: only a staff session explicitly declaring a published
// disclosure yields `public`. Everything else — including a staff upload with
// no declaration — is `org_submitted`. "Flag it, don't assume."
export function classifyUpload(input: ClassifyUploadInput): DataClass {
  if (input.sessionKind === "indigenomics" && input.declaredPublic === true) {
    return "public";
  }
  return "org_submitted";
}

// Dynamo's strip<T>() is a blind cast: a row written before dataClass existed
// unmarshals to `undefined` while TypeScript believes the field is present.
// Coerce at the read boundary so the type is honest and the value fails CLOSED
// (conservative), never open. Same rule as the backfill's planRapDataClass.
export function coerceDataClass(v: unknown): DataClass {
  return v === "public" || v === "org_submitted" ? v : "org_submitted";
}
