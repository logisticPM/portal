// Tests for the pure citation-treatment module (spec 2026-07-19). Offline, no network.
import assert from "node:assert/strict";

(async () => {
  const { leadParty, findCitingPassage } = await import("../src/lib/cases/treatment");
  const ch = (paragraph: string, text: string) => ({ paragraph, text });
  const target = { citation: "2004 SCC 73", citation2: "[2004] 3 SCR 511", styleOfCause: "Haida Nation v. British Columbia (Minister of Forests)" };

  // --- leadParty ---
  assert.equal(leadParty("Haida Nation v. British Columbia (Minister of Forests)"), "Haida Nation");
  assert.equal(leadParty("R. v. Sparrow"), "R.");
  assert.equal(leadParty("Reference re Secession of Quebec"), "Reference re Secession of Quebec");

  // --- citation match ---
  const p1 = findCitingPassage([ch("para-5", "The court applied Haida Nation, 2004 SCC 73, to these facts.")], target);
  assert.ok(p1 && p1.paragraph === "para-5" && p1.text.includes("2004 SCC 73"));

  // --- citation2 fallback (no neutral cite in text) ---
  const p2 = findCitingPassage([ch("para-2", "See [2004] 3 SCR 511 on the duty to consult.")], target);
  assert.ok(p2 && p2.text.includes("[2004] 3 SCR 511"));

  // --- leadParty fallback ---
  const p3 = findCitingPassage([ch("para-1", "As held in Haida Nation, consultation is required.")], target);
  assert.ok(p3 && p3.text.includes("Haida Nation"));

  // --- precedence: citation (later chunk) beats leadParty (earlier chunk) ---
  const p4 = findCitingPassage([
    ch("para-1", "Following Haida Nation broadly."),
    ch("para-9", "precisely per 2004 SCC 73 at para 35."),
  ], target);
  assert.equal(p4?.paragraph, "para-9");

  // --- short lead party (<4 chars) not used → no false match ---
  const p5 = findCitingPassage([ch("para-1", "In R. the accused argued ...")], { citation: "1990 SCC 1", styleOfCause: "R. v. Sparrow" });
  assert.equal(p5, null);

  // --- no reference → null ---
  assert.equal(findCitingPassage([ch("para-1", "entirely unrelated text")], target), null);

  // --- windowing: long chunk truncated with … and excerpt is a verbatim substring ---
  const long = "x".repeat(300) + "2004 SCC 73" + "y".repeat(300);
  const p6 = findCitingPassage([ch("para-1", long)], target);
  assert.ok(p6 && p6.truncated && p6.text.startsWith("…") && p6.text.endsWith("…"));
  assert.ok(long.includes(p6!.text.replace(/^…/, "").replace(/…$/, "")));

  // --- short chunk fully shown: no truncation, no ellipsis, verbatim ---
  const short = "See 2004 SCC 73 here.";
  const p7 = findCitingPassage([ch("para-1", short)], target);
  assert.ok(p7 && !p7.truncated && !p7.text.includes("…") && p7.text === short);

  console.log("✅ test-cases-treatment passed");
})().catch((e) => { console.error(e); process.exit(1); });
