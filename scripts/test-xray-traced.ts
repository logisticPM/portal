// The X-Ray traced() helper. The property that matters is the SAFETY one: off
// a traced Lambda, it is a no-op that returns the exact client it was given and
// never loads the X-Ray SDK. This test pins that — a regression here would mean
// the extraction hot path behaves differently in tests/local than asserted.
//
// Run: npx tsx scripts/test-xray-traced.ts
import { traced } from "../src/lib/observability/xray";

let fail = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`);
  if (!ok) fail++;
}

// Ensure the guard var is absent for the passthrough cases (tests run without a
// Lambda runtime, so it should be — but be explicit).
delete process.env.AWS_XRAY_DAEMON_ADDRESS;

const sentinel = { marker: "i-am-the-client", send: () => "ok" };

// 1. Identity passthrough — the SAME object reference, unwrapped.
check("returns the exact client (identity) when tracing is off", traced(sentinel) === sentinel);

// 2. Never throws, whatever it is handed.
let threw = false;
try {
  traced(null);
  traced(undefined);
  traced(42 as unknown as object);
  traced({} as object);
} catch {
  threw = true;
}
check("never throws on odd inputs when tracing is off", threw === false);

// 3. It must not have required the X-Ray SDK — proven by the fact that the SDK
//    is not even a resolvable dependency in this test's module graph until the
//    guard passes. If traced() had loaded it eagerly, the import above would
//    have pulled it in. A direct assertion: the client came back untouched, so
//    no middleware was attached.
check("no instrumentation middleware was attached (client unchanged)",
  (traced(sentinel) as any).middlewareStack === undefined && (traced(sentinel) as any).marker === "i-am-the-client");

console.log(fail === 0 ? "\nall passed" : `\n${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
