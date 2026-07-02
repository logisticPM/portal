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
  return l2normalize(v);
}

// L2-normalize in place so dot product == cosine similarity (the retrieval contract).
function l2normalize(v: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

// Amazon Bedrock embeddings (Titan Text Embeddings V2 by default; also Cohere
// Embed v3). Region + credentials come from the standard AWS chain — INDEPENDENT
// of DYNAMO_ENDPOINT, so "local DynamoDB + real Bedrock" works. The SDK is
// lazy-imported so the stub path stays dependency-free/offline.
class BedrockEmbedder implements Embedder {
  readonly id: string;
  private clientP: Promise<{ send: (c: unknown) => Promise<{ body: Uint8Array }>; Cmd: new (a: unknown) => unknown }> | null = null;

  constructor(readonly model: string, readonly dim: number, readonly region: string) {
    this.id = `bedrock:${model}`;
  }

  private async lazyClient() {
    if (!this.clientP) {
      this.clientP = import("@aws-sdk/client-bedrock-runtime").then((m) => {
        const client = new m.BedrockRuntimeClient({ region: this.region });
        return {
          send: (c: unknown) => client.send(c as never) as Promise<{ body: Uint8Array }>,
          Cmd: m.InvokeModelCommand as unknown as new (a: unknown) => unknown,
        };
      });
    }
    return this.clientP;
  }

  private async invoke(body: unknown): Promise<any> {
    const { send, Cmd } = await this.lazyClient();
    const res = await send(
      new Cmd({
        modelId: this.model,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify(body),
      }),
    );
    return JSON.parse(new TextDecoder().decode(res.body));
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    // Cohere Embed v3 — batches up to 96 texts per call.
    if (this.model.startsWith("cohere.embed")) {
      const out: Float32Array[] = [];
      for (let i = 0; i < texts.length; i += 96) {
        const batch = texts.slice(i, i + 96).map((t) => t || " ");
        const json = await this.invoke({
          texts: batch,
          input_type: "search_document",
          embedding_types: ["float"],
        });
        const embs: number[][] = json.embeddings?.float ?? json.embeddings;
        for (const e of embs) out.push(l2normalize(Float32Array.from(e)));
      }
      return out;
    }
    // Titan Text Embeddings V2 (default) — one text per call, native normalize.
    const out: Float32Array[] = [];
    for (const t of texts) {
      if (!t.trim()) {
        out.push(new Float32Array(this.dim)); // empty chunk → zero vector (skip)
        continue;
      }
      const json = await this.invoke({ inputText: t, dimensions: this.dim, normalize: true });
      out.push(l2normalize(Float32Array.from(json.embedding as number[])));
    }
    return out;
  }
}

export function getEmbedder(): Embedder {
  const provider = (process.env.EMBED_PROVIDER ?? "").trim().toLowerCase();
  const dim = Number(process.env.EMBED_DIM ?? "1024") || 1024;
  if (!provider || provider === "stub") return new StubEmbedder(dim);
  if (provider === "bedrock") {
    const model = (process.env.EMBED_MODEL ?? "amazon.titan-embed-text-v2:0").trim();
    const region = (process.env.BEDROCK_REGION ?? process.env.AWS_REGION ?? "us-east-1").trim();
    return new BedrockEmbedder(model, dim, region);
  }
  throw new Error(`Unknown EMBED_PROVIDER "${provider}" (use "stub" or "bedrock").`);
}
