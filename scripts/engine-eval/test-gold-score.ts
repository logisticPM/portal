import { scoreAgainstGold } from "./gold-score";
let fail = 0;
function check(name: string, ok: boolean) { console.log(`${ok ? "✅" : "❌"} ${name}`); if (!ok) fail++; }

const gold = [
  { page: 13, action: "Invest in the CBNII to share work and learn best practices" },
  { page: 15, action: "Develop a framework to support Indigenous participation" },
];
// one exact-ish hit on the right page, one miss
const extracted = [
  { action: { value: "Invest in the CBNII to share work and learn best practices in economic Reconciliation" }, page: 13 },
  { action: { value: "Something entirely unrelated about catering" }, page: 4 },
];
const s = scoreAgainstGold(extracted, gold);
check("1 action match", s.actionMatches === 1);
check("1 page match", s.pageMatches === 1);
check("recall = 0.5", Math.abs(s.recall - 0.5) < 1e-9);
check("precision = 0.5", Math.abs(s.precision - 0.5) < 1e-9);
check("f1 = 0.5", Math.abs(s.f1 - 0.5) < 1e-9);
check("misses lists the framework gold", s.misses.some((m) => m.includes("framework")));

const empty = scoreAgainstGold([], gold);
check("empty extraction → recall 0, f1 0 (no crash)", empty.recall === 0 && empty.f1 === 0 && empty.precision === 0);
process.exit(fail ? 1 : 0);
