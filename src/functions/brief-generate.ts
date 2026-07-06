// Async briefing worker. Invoked fire-and-forget (InvocationType "Event") by the
// requestBriefing server action — generation takes 15-60s, beyond the web
// function's ~20s budget. Function config lives in sst.config.ts ("BriefGen").
import { runBriefGeneration } from "../lib/cases/briefs/run";

export async function handler(event: { briefId?: string }) {
  if (!event?.briefId) { console.warn("[briefs] worker invoked without briefId"); return; }
  console.log("[briefs] generating", event.briefId);
  await runBriefGeneration(event.briefId);
}
