// Provider-agnostic LLM client for theme labeling. Two model families are configured
// via env (server-side only). Responses cached by content hash so re-runs are free and
// the labeler is offline-replayable. Never used in unit tests (live calls only).
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Theme } from "../types";
import { ALL_THEMES } from "./rubric";

const CACHE = path.join(process.cwd(), "scripts", ".cache", "llm");

export interface LlmModel { id: string; call: (prompt: string) => Promise<string>; }

// Configure the two families from env. Implement `call` against your provider
// (e.g. Bedrock Claude + a non-Anthropic family). Throw if keys are missing.
export function configuredModels(): LlmModel[] {
  const ids = (process.env.LABEL_MODELS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length < 2) throw new Error("Set LABEL_MODELS to two comma-separated model ids (different families).");
  return ids.map((id) => ({ id, call: (p) => callProvider(id, p) }));
}

async function callProvider(modelId: string, prompt: string): Promise<string> {
  // Provider wiring lives here (Bedrock InvokeModel / OpenAI / etc.), keyed by modelId
  // prefix. Kept thin and out of tests. Implementers fill the HTTP/SDK call.
  throw new Error(`callProvider not configured for ${modelId}`);
}

async function cachedCall(m: LlmModel, prompt: string): Promise<string> {
  await fs.mkdir(CACHE, { recursive: true });
  const key = createHash("sha256").update(m.id + "\n" + prompt).digest("hex").slice(0, 32);
  const file = path.join(CACHE, key + ".txt");
  try { return await fs.readFile(file, "utf8"); } catch { /* miss */ }
  const out = await m.call(prompt);
  await fs.writeFile(file, out);
  return out;
}

export function parseThemes(raw: string): Theme[] {
  try {
    const arr = JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1));
    return (Array.isArray(arr) ? arr : []).filter((t): t is Theme => ALL_THEMES.includes(t));
  } catch { return []; }
}

export async function labelWithModel(m: LlmModel, prompt: string): Promise<Theme[]> {
  return parseThemes(await cachedCall(m, prompt));
}
