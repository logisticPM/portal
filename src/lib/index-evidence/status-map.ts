// Map a self-reported RapData progress status onto the commitments display
// lifecycle. Self-report NEVER maps to "confirmed" — only the confirmation bridge
// (independent supplier attestation) can raise a commitment to confirmed. "met" is
// capped at "reported" (a self-report can't be more than reported).
import type { ProgressStatus } from "@/lib/rap/types";
import type { CommitmentStatus } from "@/lib/commitments/types";

export function rapStatusToDisplay(s: ProgressStatus): CommitmentStatus {
  switch (s) {
    case "met": return "reported";
    case "on_track": return "in_progress";
    case "delayed": return "stalled";
    case "missed": return "stalled";
    case "not_started": return "committed";
    default: return "committed";
  }
}
