// Provider-agnostic LLM client for theme labeling. Two model families are configured
// via env (server-side only). Responses cached by content hash so re-runs are free and
// the labeler is offline-replayable. `stub:` ids run a deterministic offline test stub
// (never authoritative); real ids call Bedrock Converse (uniform across families).
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Theme } from "../types";
import { ALL_THEMES } from "./rubric";

const CACHE = path.join(process.cwd(), "scripts", ".cache", "llm");

export interface LlmModel { id: string; call: (prompt: string) => Promise<string>; }

export interface CallOpts { maxTokens?: number }

// Configure the two families from env. Implement `call` against your provider
// (e.g. Bedrock Claude + a non-Anthropic family). Throw if keys are missing.
export function configuredModels(): LlmModel[] {
  const ids = (process.env.LABEL_MODELS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length < 2) throw new Error("Set LABEL_MODELS to two comma-separated model ids (different families).");
  return ids.map((id) => modelFromId(id));
}

// Build a single LlmModel from a model id, baking call options into the closure
// so LlmModel.call keeps its (prompt) => Promise<string> shape. Options are
// copied at construction so later mutation of the caller's object has no effect.
export function modelFromId(id: string, opts?: CallOpts): LlmModel {
  const frozen = { ...opts };
  return { id, call: (p) => callProvider(id, p, frozen) };
}

async function callProvider(modelId: string, prompt: string, opts?: CallOpts): Promise<string> {
  if (modelId.startsWith("stub:")) return stubLabelResponse(modelId, prompt);
  return converse(modelId, prompt, opts);
}

// Deterministic TEST stub (no key, no network): sha256(id+prompt) picks a subset of
// ALL_THEMES and returns it as a JSON array string. Semantically meaningless by
// design (same ethos as the stub-hash-v1 embedder): it only makes labelCase runnable
// end-to-end offline and tests stable. NEVER authoritative — real labels come from
// the credentialed dual-LLM run.
function stubLabelResponse(modelId: string, prompt: string): string {
  const h = createHash("sha256").update(modelId + "\n" + prompt).digest();
  const picked = ALL_THEMES.filter((_, i) => h[i % h.length] % 3 === 0);
  return JSON.stringify(picked);
}

// Bedrock Converse API — uniform request/response across model families (Claude,
// Nova, Llama, …), which is what LABEL_MODELS' two-different-families requirement
// needs (no per-family body formats). Lazy import keeps the stub path offline.
let bedrockP: Promise<{ send: (modelId: string, prompt: string, opts?: CallOpts) => Promise<string> }> | null = null;
function bedrockConverse() {
  if (!bedrockP) {
    bedrockP = import("@aws-sdk/client-bedrock-runtime").then((m) => {
      const region = (process.env.BEDROCK_REGION ?? process.env.AWS_REGION ?? "us-east-1").trim();
      const client = new m.BedrockRuntimeClient({ region });
      return {
        send: async (modelId: string, prompt: string, opts?: CallOpts) => {
          const res = await client.send(new m.ConverseCommand({
            modelId,
            messages: [{ role: "user", content: [{ text: prompt }] }],
            inferenceConfig: { temperature: 0, maxTokens: opts?.maxTokens ?? 256 },
          }));
          const parts = res.output?.message?.content ?? [];
          return parts.map((p) => ("text" in p && p.text ? p.text : "")).join("");
        },
      };
    });
  }
  return bedrockP;
}

async function converse(modelId: string, prompt: string, opts?: CallOpts): Promise<string> {
  return (await bedrockConverse()).send(modelId, prompt, opts);
}

let cacheWriteWarned = false;
export async function cachedCall(m: LlmModel, prompt: string): Promise<string> {
  const key = createHash("sha256").update(m.id + "\n" + prompt).digest("hex").slice(0, 32);
  const file = path.join(CACHE, key + ".txt");
  try { return await fs.readFile(file, "utf8"); } catch { /* miss (incl. no cache dir) */ }
  const out = await m.call(prompt);
  // The disk cache is a local-dev optimization; a read-only FS (e.g. a Lambda's
  // /var/task) must never be fatal — warn once, then proceed uncached.
  try {
    await fs.mkdir(CACHE, { recursive: true });
    await fs.writeFile(file, out);
  } catch (e) {
    if (!cacheWriteWarned) { cacheWriteWarned = true; console.warn("[llm] response cache disabled (read-only FS?):", e instanceof Error ? e.message : String(e)); }
  }
  return out;
}

// Wrap a model so calls go through the disk cache (batch runners use this;
// summarizeCase itself calls the model directly so tests stay cache-free).
// Cache key is (id, prompt) only — CallOpts are deliberately NOT keyed (constant
// per use-site). Changing opts for the same (id, prompt) replays stale output;
// clear scripts/.cache/llm if you do.
export const cachedModel = (m: LlmModel): LlmModel => ({ id: m.id, call: (p) => cachedCall(m, p) });

export function parseThemes(raw: string): Theme[] {
  try {
    const arr = JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1));
    return (Array.isArray(arr) ? arr : []).filter((t): t is Theme => ALL_THEMES.includes(t));
  } catch { return []; }
}

export async function labelWithModel(m: LlmModel, prompt: string): Promise<Theme[]> {
  return parseThemes(await cachedCall(m, prompt));
}
