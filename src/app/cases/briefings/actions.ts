"use server";
// Briefing request flow (spec 2026-07-05 §3): session gate → validation →
// question-hash cache → daily quota → create pending brief → async worker
// (deployed) or inline generation (local dev) → redirect to the brief page.
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import {
  BRIEF_DAILY_LIMIT, bumpQuota, createBrief, findByQuestionHash, questionHash, setBriefFailed,
} from "@/lib/cases/briefs/repo";
import { runBriefGeneration } from "@/lib/cases/briefs/run";

async function invokeBriefWorker(functionName: string, briefId: string) {
  const { LambdaClient, InvokeCommand } = await import("@aws-sdk/client-lambda");
  await new LambdaClient({}).send(new InvokeCommand({
    FunctionName: functionName,
    InvocationType: "Event",
    Payload: new TextEncoder().encode(JSON.stringify({ briefId })),
  }));
}

export async function requestBriefing(formData: FormData) {
  const session = getSession();
  if (!session) redirect("/login");
  const question = String(formData.get("question") ?? "").trim();
  if (question.length < 10 || question.length > 500) redirect("/cases/briefings?err=length");
  const requester = session!.partyId ? `${session!.kind}:${session!.partyId}` : session!.kind;

  // Cache: identical (normalized) question → the existing briefing, no spend, no quota.
  const hash = questionHash(question);
  const existing = await findByQuestionHash(hash);
  if (existing) redirect(`/cases/briefings/${existing.id}`);

  const today = new Date().toISOString().slice(0, 10);
  const used = await bumpQuota(requester, today);
  if (used > BRIEF_DAILY_LIMIT) redirect("/cases/briefings?err=quota");

  const id = globalThis.crypto.randomUUID();
  await createBrief({
    id, question, questionHash: hash, status: "pending", retrievedCaseIds: [],
    model: process.env.BRIEF_MODEL ?? "us.meta.llama3-3-70b-instruct-v1:0",
    requester, createdAt: new Date().toISOString(),
  });

  const workerFn = process.env.BRIEF_FUNCTION_NAME;
  if (workerFn) {
    try { await invokeBriefWorker(workerFn, id); }
    catch (e) { await setBriefFailed(id, `worker invoke failed: ${e instanceof Error ? e.message : String(e)}`); }
  } else {
    await runBriefGeneration(id); // local dev: inline (next dev has no request time limit)
  }
  redirect(`/cases/briefings/${id}`);
}
