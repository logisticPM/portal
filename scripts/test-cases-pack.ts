import assert from "node:assert/strict";
import { packF32, unpackF32 } from "../src/lib/cases/search/pack";

const v = Float32Array.from([1, -2.5, 3.25, 0, 0.125]);
const buf = packF32(v);
assert.equal(buf.length, v.length * 4, "4 bytes per float");

// round-trip is exact (values are already float32)
const back = unpackF32(buf, v.length);
assert.deepEqual(Array.from(back), Array.from(v), "round-trip equal");

// DynamoDB returns Binary as Uint8Array — unpack must accept it
const asU8 = new Uint8Array(buf);
const back2 = unpackF32(asU8, v.length);
assert.deepEqual(Array.from(back2), Array.from(v), "unpack accepts Uint8Array");

console.log("✅ pack tests passed");
