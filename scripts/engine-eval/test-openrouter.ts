import { openRouterModel } from "./openrouter";
let fail = 0;
function check(name: string, ok: boolean) { console.log(`${ok ? "✅" : "❌"} ${name}`); if (!ok) fail++; }

process.env.EVAL_STUB_LLM = "1";
delete process.env.OPENROUTER_API_KEY;

(async () => {
  const m = openRouterModel("moonshotai/kimi-k2.5");
  check("id set", m.id === "moonshotai/kimi-k2.5");
  const out = await m.call("anything");
  check("stub returns STUB offline", out === "STUB");
  process.exit(fail ? 1 : 0);
})();
