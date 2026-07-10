import assert from "node:assert/strict";
import { isValidBN } from "../src/lib/rap/bn";

// 9-digit BN with a valid Luhn check digit (Enbridge Inc. root from Corporations Canada)
assert.deepEqual(isValidBN("119653384"), { bn9: "119653384" }, "bare 9-digit BN");
assert.deepEqual(isValidBN("119653384RC0001"), { bn9: "119653384" }, "strips RC program account");
assert.deepEqual(isValidBN("11965 3384 RC0001"), { bn9: "119653384" }, "tolerates spacing");
assert.equal(isValidBN("123456789"), null, "bad Luhn check digit → null");
assert.equal(isValidBN("12345"), null, "too short → null");
assert.equal(isValidBN("119653384XX0001"), null, "unknown program id → null");
assert.equal(isValidBN(""), null, "empty → null");
console.log("OK test-rap-bn");
