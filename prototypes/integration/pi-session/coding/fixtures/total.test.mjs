import assert from "node:assert/strict";
import { totalCents } from "./total.mjs";

const cases = [
  ["empty cart", [], 0],
  ["single item", [{ priceCents: 125, quantity: 1 }], 125],
  ["multiple units", [{ priceCents: 125, quantity: 3 }], 375],
  ["zero quantity", [{ priceCents: 125, quantity: 0 }], 0],
  ["mixed cart", [{ priceCents: 125, quantity: 2 }, { priceCents: 80, quantity: 3 }], 490],
  ["free item", [{ priceCents: 0, quantity: 4 }], 0],
];
let failed = 0;
for (const [name, items, expected] of cases) {
  try {
    const actual = totalCents(items);
    assert.equal(actual, expected);
    console.log(`PASS ${name}: ${actual}`);
  } catch (error) {
    failed++;
    console.log(`FAIL ${name}: ${error.message}`);
  }
}
console.log(`CODING TESTS: ${cases.length - failed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
