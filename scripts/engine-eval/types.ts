import type { ExtractedRap, ValidationIssue } from "@/lib/rap/types";

export type EngineKey = "bda" | "textract" | "textlayer";

export interface CorpusDoc {
  key: string;       // stable slug, e.g. "bankofcanada"
  fileName: string;  // exact PDF filename in RAP_SAMPLES_DIR
  pages: number;     // for cost/operational reporting
  isGold: boolean;   // has a human gold set
}

export interface RunResult {
  engine: EngineKey;
  docKey: string;
  fileName: string;
  sourceS3Key: string;
  timingMs: number;
  extracted: ExtractedRap | null;   // null on error
  validationIssues: ValidationIssue[];
  engineLabel: string;              // ExtractionResult.engine ("bda"|"claude"|"textract+claude")
  error: string | null;
}
