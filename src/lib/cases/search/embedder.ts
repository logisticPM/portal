// Pluggable embedder. Default = a DETERMINISTIC HASH STUB that needs no API key, so
// the whole pipeline (chunk → embed → index → rank) runs offline in CI. The stub is
// NOT semantically meaningful — it only makes the dense path runnable + tests stable.
// A real provider (Bedrock/OpenAI/self-hosted bge-m3) is selected via EMBED_PROVIDER,
// mirroring ingest/llm.ts. Every vector is stamped with the embedder `id` so a query
// from embedder X is never cosine-compared against vectors written by embedder Y.
import { createHash } from "node:crypto";

export interface Embedder {
  readonly id: string;
  readonly dim: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}

export class StubEmbedder implements Embedder {
  readonly id = "stub-hash-v1";
  constructor(readonly dim = 1024) {}

  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => stubVector(t, this.dim));
  }
}

function stubVector(text: string, dim: number): Float32Array {
  const v = new Float32Array(dim);
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  for (const tok of tokens) {
    const h = createHash("sha256").update(tok).digest(); // 32 bytes
    for (let i = 0; i < dim; i++) v[i] += (h[i % h.length] - 127.5) / 127.5;
  }
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i++) v[i] /= norm;
  return v;
}

// Real provider wiring lives here (Bedrock InvokeModel / OpenAI / bge-m3 HTTP), kept
// thin and out of tests — exactly like ingest/llm.ts callProvider. Implementers fill
// the call and MUST L2-normalize the output. Throws until configured.
class ProviderEmbedder implements Embedder {
  readonly id: string;
  constructor(readonly provider: string, readonly model: string, readonly dim: number) {
    this.id = `${provider}:${model}`;
  }
  async embed(_texts: string[]): Promise<Float32Array[]> {
    throw new Error(`ProviderEmbedder not configured for ${this.id} — implement the provider call.`);
  }
}

export function getEmbedder(): Embedder {
  const provider = (process.env.EMBED_PROVIDER ?? "").trim();
  const dim = Number(process.env.EMBED_DIM ?? "1024") || 1024;
  if (!provider) return new StubEmbedder(dim);
  const model = (process.env.EMBED_MODEL ?? "").trim();
  if (!model) throw new Error("EMBED_PROVIDER set but EMBED_MODEL missing.");
  return new ProviderEmbedder(provider, model, dim);
}
