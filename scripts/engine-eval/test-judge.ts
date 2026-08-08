import { parseVerdict, cohenKappa, buildWorklist, judgeFindings } from "./judge";
import type { JudgeModel } from "./judge";
let fail = 0;
function check(name: string, ok: boolean) { console.log(`${ok ? "✅" : "❌"} ${name}`); if (!ok) fail++; }

check("parse real true", parseVerdict('{"real": true}').real === true);
check("parse real false", parseVerdict('{"real": false}').real === false);
check("parse garbage → false", parseVerdict("who knows").real === false);

// perfect agreement → kappa 1
check("kappa perfect = 1", Math.abs(cohenKappa([true, false, true], [true, false, true]) - 1) < 1e-9);
// total disagreement on balanced labels → kappa negative/zero
check("kappa opposite ≤ 0", cohenKappa([true, false], [false, true]) <= 0);

const findings = [
  { docKey: "d", engine: "e", action: "real one", quote: "q", page: 1 },
  { docKey: "d", engine: "e", action: "fake one", quote: null, page: null },
];
const yes: JudgeModel = { id: "yes", call: async () => '{"real": true}' };
const no: JudgeModel = { id: "no", call: async () => '{"real": false}' };

(async () => {
  const judged = await judgeFindings(findings, yes, no, () => "window");
  check("both findings judged", judged.length === 2);
  check("all disagree (yes vs no)", judged.every((j) => j.agree === false));
  const worklist = buildWorklist(judged, 25);
  check("worklist has both disagreements", worklist.length === 2);
  check("cap respected", buildWorklist(judged, 1).length === 1);
  process.exit(fail ? 1 : 0);
})();
