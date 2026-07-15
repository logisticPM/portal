import { rapStatusToDisplay } from "../src/lib/index-evidence/status-map";
let pass = 0, fail = 0;
const check = (n: string, ok: boolean) => { console.log(`${ok ? "✅" : "❌"} ${n}`); ok ? pass++ : fail++; };
async function main() {
  check("met → reported (capped, never confirmed)", rapStatusToDisplay("met") === "reported");
  check("on_track → in_progress", rapStatusToDisplay("on_track") === "in_progress");
  check("delayed → stalled", rapStatusToDisplay("delayed") === "stalled");
  check("missed → stalled", rapStatusToDisplay("missed") === "stalled");
  check("not_started → committed", rapStatusToDisplay("not_started") === "committed");
  check("self-report never maps to confirmed", (["met","on_track","delayed","missed","not_started"] as const).every((s) => rapStatusToDisplay(s) !== "confirmed"));
  process.exit(fail ? 1 : 0);
}
main();
