// scripts/engine-eval/test-agreement.ts
import { tokenSet, jaccard } from "./util";
import { computeAgreement } from "./agreement";
let fail = 0;
function check(name: string, ok: boolean) { console.log(`${ok ? "✅" : "❌"} ${name}`); if (!ok) fail++; }

check("jaccard identical = 1", jaccard(tokenSet("hire indigenous staff"), tokenSet("hire indigenous staff")) === 1);
check("jaccard disjoint = 0", jaccard(tokenSet("alpha beta"), tokenSet("gamma delta")) === 0);

const report = computeAgreement([
  { engine: "a", actions: ["Hire more Indigenous staff by 2025", "Build a new supplier program"] },
  { engine: "b", actions: ["hire more indigenous staff by 2025"] },  // matches a's first
  { engine: "c", actions: ["Totally different climate pledge"] },
]);
check("union has 3 clusters", report.unionSize === 3);
const a = report.perEngine.find((e) => e.engine === "a")!;
check("engine a found 2", a.found === 2);
check("engine a corroborated 1 (staff cluster, ≥2 engines)", a.corroborated === 1);
const c = report.perEngine.find((e) => e.engine === "c")!;
check("engine c corroborated 0 (solo)", c.corroborated === 0);
process.exit(fail ? 1 : 0);
