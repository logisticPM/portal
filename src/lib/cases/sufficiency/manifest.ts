// A log of every test-set run.
//
// The test set can only be spent once. The pre-registered rule (spec §2) is that a failing test
// result does NOT license going back and choosing another configuration — that would turn test
// into a second dev set. This file makes a second run visible rather than preventing it: the
// runner prints every prior entry at startup, so a later reader can see that the reported number
// was the third attempt, not the first.
//
// Append-only by design. Overwriting would erase exactly the evidence this exists to keep.
import { promises as fs } from "node:fs";
import path from "node:path";
import type { ArmCounts } from "./tally";

export interface TestRun { configId: string; at: string; armS: ArmCounts; armX: ArmCounts }

const FILE = "test-runs.jsonl";

// A missing manifest means no test run has happened yet, which is the normal first case — not
// an error. A manifest that fails to READ for any other reason, or that exists but fails to
// PARSE, is not that case: a process killed mid-append leaves a truncated final line on disk,
// and that is damage, not absence. Reporting it as "no prior runs" would erase the one thing this
// file exists to preserve — so only ENOENT is swallowed; every other failure, especially a
// JSON.parse rejection, propagates instead of being folded into the empty-list case.
export async function readTestRuns(dir: string): Promise<TestRun[]> {
  const file = path.join(dir, FILE);
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  return raw.trim().split("\n").filter(Boolean).map((l, i) => {
    try {
      return JSON.parse(l) as TestRun;
    } catch (e) {
      throw new Error(
        `${file} line ${i + 1} is not valid JSON — the manifest is damaged, not empty (a killed ` +
        `process can truncate the last append). Recover or remove the bad line by hand; do not treat ` +
        `this as "no prior runs". Underlying error: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  });
}

export async function appendTestRun(dir: string, run: TestRun): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.appendFile(path.join(dir, FILE), JSON.stringify(run) + "\n", "utf8");
}
