// scripts/engine-eval/test-grounding.ts
import { scoreGrounding } from "./grounding";
import { pageText } from "./util";
let fail = 0;
function check(name: string, ok: boolean) { console.log(`${ok ? "✅" : "❌"} ${name}`); if (!ok) fail++; }

const pages = [
  ["We will hire Indigenous staff.", "First page filler."],   // page 1
  ["We commit to spend $5M with Indigenous suppliers."],       // page 2
];
check("pageText page 2", pageText(pages, 2).includes("$5M"));
check("pageText out-of-range → empty", pageText(pages, 9) === "");

const score = scoreGrounding([
  { quote: "We will hire Indigenous staff.", page: 1 },     // present, right page
  { quote: "We commit to spend $5M with Indigenous suppliers.", page: 1 }, // present text, WRONG page
  { quote: "This sentence appears nowhere in the doc.", page: 1 },          // absent
], pages);
check("3 fields total", score.total === 3);
check("2 quotes present", score.quotePresent === 2);
check("1 page-correct", score.pagePresent === 1);
process.exit(fail ? 1 : 0);
