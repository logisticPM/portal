// Async worker for grounded-generation jobs. Invoked fire-and-forget (InvocationType "Event"):
// briefings (requestBriefing) and single-case Q&A (askCase). Config: sst.config.ts "BriefGen".
import { runBriefGeneration } from "../lib/cases/briefs/run";
import { runCaseQa } from "../lib/cases/caseqa/run";

export async function handler(event: { briefId?: string; caseQaId?: string }) {
  if (event?.caseQaId) { console.log("[caseqa] generating", event.caseQaId); await runCaseQa(event.caseQaId); return; }
  if (event?.briefId) { console.log("[briefs] generating", event.briefId); await runBriefGeneration(event.briefId); return; }
  console.warn("[worker] invoked without briefId/caseQaId");
}
