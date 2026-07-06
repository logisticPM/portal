// Shared briefing runner — called by the async worker (deployed) and inline by
// the server action (local dev, where there is no 20s request-Lambda limit).
// Never throws: every failure path lands in setBriefFailed so no brief is
// stranded in "pending".
import { dynamoCaseRepo } from "../repo.dynamo";
import { cachedModel, modelFromId } from "../ingest/llm";
import { generateBriefing } from "./generator";
import { getBrief, setBriefDone, setBriefFailed, setBriefRetrieved } from "./repo";

const BRIEF_MODEL = process.env.BRIEF_MODEL ?? "us.meta.llama3-3-70b-instruct-v1:0";
const TOP_K = 6;

export async function runBriefGeneration(briefId: string): Promise<void> {
  try {
    const brief = await getBrief(briefId);
    if (!brief || brief.status !== "pending") return;
    // Retrieval over the curated core only (same ranked search as the site).
    const results = await dynamoCaseRepo.hybridSearch(brief.question, { tier: "core" });
    const cases = results.slice(0, TOP_K);
    await setBriefRetrieved(briefId, cases.map((c) => c.id));
    const model = cachedModel(modelFromId(BRIEF_MODEL, { maxTokens: 2048 }));
    const r = await generateBriefing(brief.question, cases, model);
    if (r.status === "done") await setBriefDone(briefId, brief.questionHash, r.body, r.dropped);
    else await setBriefFailed(briefId, r.failReason);
  } catch (e) {
    console.error("[briefs] generation error:", e);
    await setBriefFailed(briefId, "generation error — please try again").catch(() => {});
  }
}
