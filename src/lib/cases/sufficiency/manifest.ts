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
// an error.
export async function readTestRuns(dir: string): Promise<TestRun[]> {
  try {
    const raw = await fs.readFile(path.join(dir, FILE), "utf8");
    return raw.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as TestRun);
  } catch { return []; }
}

export async function appendTestRun(dir: string, run: TestRun): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.appendFile(path.join(dir, FILE), JSON.stringify(run) + "\n", "utf8");
}
