"use server";
// Single-case Q&A request flow: session gate → validation → per-case hash cache → daily quota
// → create pending → async worker (deployed) or inline (local) → redirect back to the case page.
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import {
  CASEQA_DAILY_LIMIT, bumpCaseQaQuota, caseQuestionHash, createCaseQa, findByCaseQuestionHash, setCaseQaFailed,
} from "@/lib/cases/caseqa/repo";
import { runCaseQa } from "@/lib/cases/caseqa/run";

async function invokeCaseQaWorker(functionName: string, caseQaId: string) {
  const { LambdaClient, InvokeCommand } = await import("@aws-sdk/client-lambda");
  await new LambdaClient({}).send(new InvokeCommand({
    FunctionName: functionName, InvocationType: "Event",
    Payload: new TextEncoder().encode(JSON.stringify({ caseQaId })),
  }));
}

export async function askCase(formData: FormData) {
  const session = getSession();
  if (!session) redirect("/login");
  const caseId = String(formData.get("caseId") ?? "");
  const question = String(formData.get("question") ?? "").trim();
  if (!caseId) redirect("/cases");
  if (question.length < 8 || question.length > 400) redirect(`/cases/${caseId}?askerr=length`);
  const requester = session!.partyId ? `${session!.kind}:${session!.partyId}` : session!.kind;

  const hash = caseQuestionHash(caseId, question);
  const existing = await findByCaseQuestionHash(hash);
  if (existing) redirect(`/cases/${caseId}?ask=${existing.id}`);

  const today = new Date().toISOString().slice(0, 10);
  const used = await bumpCaseQaQuota(requester, today);
  if (used > CASEQA_DAILY_LIMIT) redirect(`/cases/${caseId}?askerr=quota`);

  const id = globalThis.crypto.randomUUID();
  await createCaseQa({
    id, caseId, question, questionHash: hash, status: "pending",
    model: process.env.BRIEF_MODEL ?? "us.meta.llama3-3-70b-instruct-v1:0",
    requester, createdAt: new Date().toISOString(),
  });

  const workerFn = process.env.BRIEF_FUNCTION_NAME;
  if (workerFn) {
    try { await invokeCaseQaWorker(workerFn, id); }
    catch (e) { await setCaseQaFailed(id, `worker invoke failed: ${e instanceof Error ? e.message : String(e)}`); }
  } else {
    await runCaseQa(id); // local dev: inline
  }
  redirect(`/cases/${caseId}?ask=${id}`);
}
