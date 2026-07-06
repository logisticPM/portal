// Shared briefing runner — called by the async worker (deployed) and inline by
// the server action (local dev, where there is no 20s request-Lambda limit).
// Never throws: every failure path lands in setBriefFailed so no brief is
// stranded in "pending".
// Never throwing also means the async invoke never errors, so AWS does not fire its default retries; the only re-run path is a timeout/OOM (uncatchable), where the status !== "pending" guard makes a re-run safe.
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
    // Use the model recorded on the brief so the model USED matches the model
    // RECORDED (provenance can't disagree across the two Lambdas); BRIEF_MODEL is
    // the fallback for records created before a model was set.
    const modelId = brief.model ?? BRIEF_MODEL;
    const model = cachedModel(modelFromId(modelId, { maxTokens: 2048 }));
    const r = await generateBriefing(brief.question, cases, model);
    if (r.status === "done") await setBriefDone(briefId, brief.questionHash, r.body, r.dropped);
    else await setBriefFailed(briefId, r.failReason);
  } catch (e) {
    console.error("[briefs] generation error:", e);
    await setBriefFailed(briefId, "generation error — please try again").catch((e2) => console.error("[briefs] setBriefFailed also failed:", e2));
  }
}
