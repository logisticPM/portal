import type { JudgeModel } from "./openrouter";

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

export async function judgeFindings(
  findings: Finding[],
  judgeA: JudgeModel,
  judgeB: JudgeModel,
  pageTextFor: (f: Finding) => string,
): Promise<JudgedFinding[]> {
  const out: JudgedFinding[] = [];
  for (const f of findings) {
    const prompt = judgePrompt(f, pageTextFor(f));
    const [ra, rb] = await Promise.all([judgeA.call(prompt), judgeB.call(prompt)]);
    const va = parseVerdict(ra).real;
    const vb = parseVerdict(rb).real;
    out.push({ ...f, verdictA: va, verdictB: vb, agree: va === vb });
  }
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
