import assert from "node:assert/strict";
import { prf1, cohenKappa, pabak, wilsonInterval } from "../src/lib/cases/validate/metrics";

const close = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

const m = prf1(2, 1, 1); close(m.precision, 2 / 3); close(m.recall, 2 / 3); close(m.f1, 2 / 3);

// textbook: a=[y,y,n,n] b=[y,n,n,n] → po=.75, pe=.5, kappa=.5
const k = cohenKappa(["y", "y", "n", "n"], ["y", "n", "n", "n"]); close(k, 0.5);

close(pabak(0.75), 0.5); // 2*po-1

const w = wilsonInterval(192, 384); close(w.p, 0.5); close(w.lower, 0.4502, 2e-3); close(w.upper, 0.5498, 2e-3);
console.log("✅ metrics tests passed");
