export interface JudgeModel { id: string; call: (prompt: string) => Promise<string> }

export function openRouterModel(id: string, opts?: { maxTokens?: number }): JudgeModel {
  const maxTokens = opts?.maxTokens ?? 512;
  return {
    id,
    async call(prompt: string): Promise<string> {
      const key = process.env.OPENROUTER_API_KEY;
      if (!key) {
        if (process.env.EVAL_STUB_LLM === "1") return "STUB";
        throw new Error("OPENROUTER_API_KEY not set (or set EVAL_STUB_LLM=1 for offline runs)");
      }
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: id,
          temperature: 0,
          max_tokens: maxTokens,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      return json.choices?.[0]?.message?.content ?? "";
    },
  };
}
