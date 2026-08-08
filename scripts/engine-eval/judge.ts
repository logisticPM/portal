export interface JudgeModel { id: string; call: (prompt: string) => Promise<string> }

export interface JudgeVerdict { real: boolean }
export interface Finding { docKey: string; engine: string; action: string; quote: string | null; page: number | null }
export interface JudgedFinding extends Finding { verdictA: boolean; verdictB: boolean; agree: boolean }

export function parseVerdict(raw: string): JudgeVerdict {
  const m = raw.match(/"real"\s*:\s*(true|false)/i);
  if (m) return { real: m[1].toLowerCase() === "true" };
  return { real: false }; // conservative default
}

export function judgePrompt(f: Finding, sourceWindow: string): string {
  return [
    "You are auditing an AI's extraction of a commitment from a corporate Reconciliation Action Plan.",
    "Decide whether the EXTRACTED COMMITMENT is a genuine, specific commitment that the SOURCE TEXT supports.",
    "",
    `EXTRACTED COMMITMENT: ${f.action}`,
    `CITED QUOTE: ${f.quote ?? "(none provided)"}`,
    "",
    "SOURCE TEXT (from the cited page and nearby):",
    sourceWindow || "(no source text available for this page)",
    "",
    'Answer with ONLY a JSON object: {"real": true} or {"real": false}.',
  ].join("\n");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isThrottle(e: unknown): boolean {
  const err = e as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
  const s = `${err?.name ?? ""} ${err?.message ?? ""}`;
  return /throttl|too many requests|429/i.test(s) || err?.$metadata?.httpStatusCode === 429;
}

// Bedrock judge calls throttle under load; retry throttles with exponential
// backoff (well beyond the SDK's ~3 attempts). Non-throttle errors bubble up.
async function callWithRetry(model: JudgeModel, prompt: string, attempts = 6): Promise<string> {
  let delay = 800;
  for (let i = 0; i < attempts; i++) {
    try {
      return await model.call(prompt);
    } catch (e) {
      if (i === attempts - 1 || !isThrottle(e)) throw e;
      await sleep(delay + Math.floor(Math.random() * 400));
      delay *= 2;
    }
  }
  throw new Error("unreachable");
}

export async function judgeFindings(
  findings: Finding[],
  judgeA: JudgeModel,
  judgeB: JudgeModel,
  pageTextFor: (f: Finding) => string,
  opts?: { paceMs?: number },
): Promise<JudgedFinding[]> {
  const paceMs = opts?.paceMs ?? 0;
  const out: JudgedFinding[] = [];
  let skipped = 0;
  for (const f of findings) {
    const prompt = judgePrompt(f, pageTextFor(f));
    try {
      const [ra, rb] = await Promise.all([callWithRetry(judgeA, prompt), callWithRetry(judgeB, prompt)]);
      const va = parseVerdict(ra).real;
      const vb = parseVerdict(rb).real;
      out.push({ ...f, verdictA: va, verdictB: vb, agree: va === vb });
    } catch {
      skipped++; // persistent failure on this finding — skip rather than abort the whole pass
    }
    if (paceMs) await sleep(paceMs);
  }
  if (skipped) console.warn(`judgeFindings: skipped ${skipped}/${findings.length} findings after retries`);
  return out;
}

export function cohenKappa(a: boolean[], b: boolean[]): number {
  const n = a.length;
  if (n === 0 || n !== b.length) return 0;
  let observed = 0;
  for (let i = 0; i < n; i++) if (a[i] === b[i]) observed++;
  const po = observed / n;
  const aTrue = a.filter(Boolean).length / n;
  const bTrue = b.filter(Boolean).length / n;
  const pe = aTrue * bTrue + (1 - aTrue) * (1 - bTrue);
  return pe === 1 ? 1 : (po - pe) / (1 - pe);
}

export function buildWorklist(judged: JudgedFinding[], cap: number): JudgedFinding[] {
  return judged.filter((j) => !j.agree).slice(0, cap);
}
