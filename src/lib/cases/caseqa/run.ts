// Shared single-case Q&A runner — async worker (deployed) + inline (local dev). Never throws:
// every failure path lands in setCaseQaFailed so no record is stranded "pending".
import { dynamoCaseRepo } from "../repo.dynamo";
import { cachedModel, modelFromId } from "../ingest/llm";
import { answerCaseQuestion } from "./generator";
import { getCaseQa, setCaseQaDone, setCaseQaFailed } from "./repo";

const CASEQA_MODEL = process.env.BRIEF_MODEL ?? "us.meta.llama3-3-70b-instruct-v1:0";

export async function runCaseQa(id: string): Promise<void> {
  try {
    const qa = await getCaseQa(id);
    if (!qa || qa.status !== "pending") return;
    const c = await dynamoCaseRepo.getCase(qa.caseId);
    if (!c) { await setCaseQaFailed(id, "case not found"); return; }
    const model = cachedModel(modelFromId(qa.model ?? CASEQA_MODEL, { maxTokens: 1024 }));
    const r = await answerCaseQuestion(c, c.chunks ?? [], qa.question, model);
    if (r.status === "done") await setCaseQaDone(id, qa.questionHash, r.answer, r.dropped);
    else await setCaseQaFailed(id, r.failReason);
  } catch (e) {
    console.error("[caseqa] generation error:", e);
    await setCaseQaFailed(id, "generation error — please try again").catch((e2) => console.error("[caseqa] setCaseQaFailed also failed:", e2));
  }
}
