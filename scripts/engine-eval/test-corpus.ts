import { CORPUS } from "./corpus";
let fail = 0;
function check(name: string, ok: boolean) { console.log(`${ok ? "✅" : "❌"} ${name}`); if (!ok) fail++; }

check("corpus has 8 docs", CORPUS.length === 8);
check("exactly one gold doc", CORPUS.filter((d) => d.isGold).length === 1);
check("gold doc is BankOfCanada", CORPUS.find((d) => d.isGold)?.key === "bankofcanada");
check("all keys unique", new Set(CORPUS.map((d) => d.key)).size === 8);
check("all fileNames end in .pdf", CORPUS.every((d) => d.fileName.endsWith(".pdf")));
process.exit(fail ? 1 : 0);
