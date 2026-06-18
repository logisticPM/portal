// ===========================================================================
// Auth verification harness — `npm run verify:auth`.
// Pure checks (password, session) need no DB. The user-repo parity + rate-limit
// sections (added later) need DynamoDB Local (`npm run ddb:up`).
// ===========================================================================
import { hashPassword, verifyPassword } from "../src/lib/auth/password";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`);
  ok ? pass++ : fail++;
}

async function main() {
  // --- password ---
  const stored = await hashPassword("correct horse");
  check("password: format is salt:hash", /^[0-9a-f]+:[0-9a-f]+$/.test(stored), stored.slice(0, 16) + "…");
  check("password: correct verifies", await verifyPassword("correct horse", stored));
  check("password: wrong rejected", !(await verifyPassword("wrong", stored)));
  check("password: malformed rejected", !(await verifyPassword("x", "not-a-hash")));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
