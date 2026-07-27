// selectLoader is the seam that decides how a document becomes text. It must
// be EXPLICIT: an unknown DOC_LOADER is a deploy misconfiguration and has to
// fail loudly, never fall through to a default. See the spec's "Explicit
// selection, never silent fallback".
// Run: npx tsx scripts/test-doc-loader-select.ts
import { selectLoader } from "../src/lib/rap/doc-loader";

let fail = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`);
  if (!ok) fail++;
}

check("DOC_LOADER=textract selects the textract loader", selectLoader({ DOC_LOADER: "textract" } as unknown as NodeJS.ProcessEnv).name === "textract");
check("DOC_LOADER=textlayer selects the textlayer loader", selectLoader({ DOC_LOADER: "textlayer" } as unknown as NodeJS.ProcessEnv).name === "textlayer");

let threw = false;
try {
  selectLoader({ DOC_LOADER: "layout" } as unknown as NodeJS.ProcessEnv);
} catch (e) {
  threw = e instanceof Error && e.message.includes("DOC_LOADER");
}
check("unknown DOC_LOADER throws (no silent fallback)", threw);

let threwUnset = false;
try {
  selectLoader({} as unknown as NodeJS.ProcessEnv);
} catch {
  threwUnset = true;
}
check("unset DOC_LOADER throws rather than defaulting", threwUnset);

console.log(fail === 0 ? "\nall passed" : `\n${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
