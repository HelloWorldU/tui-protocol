import assert from "node:assert/strict";
import test from "node:test";
import { ConsumptionWatchdog } from "./consumption-watchdog.ts";

test("outstanding bytes time out once even below the pause watermark; extra sends and duplicate credits do not extend the wait", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let stops = 0;
  const watch = new ConsumptionWatchdog(100, () => stops++);
  watch.update(1, 0);
  t.mock.timers.tick(60);
  watch.update(2, 0); watch.update(2, 0);
  t.mock.timers.tick(40);
  assert.equal(stops, 1);
  watch.update(3, 0); t.mock.timers.tick(200);
  assert.equal(stops, 1);
});

test("advancing consumption restarts the idle deadline and fully draining cancels it until new output arrives", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let stops = 0;
  const watch = new ConsumptionWatchdog(100, () => stops++);
  watch.update(10, 0); t.mock.timers.tick(60);
  watch.update(5, 5); t.mock.timers.tick(60);
  assert.equal(stops, 0);
  watch.update(0, 10); t.mock.timers.tick(200);
  assert.equal(stops, 0);
  watch.update(1, 10); t.mock.timers.tick(100);
  assert.equal(stops, 1);
});

test("idle or disposed connections do not fire a consumption timeout", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let stops = 0;
  const watch = new ConsumptionWatchdog(100, () => stops++);
  watch.update(0, 0); t.mock.timers.tick(200);
  watch.update(10, 0); watch.dispose(); watch.dispose();
  t.mock.timers.tick(200); watch.update(10, 0); t.mock.timers.tick(200);
  assert.equal(stops, 0);
  for (const value of [0, -1, 1.5, NaN, Infinity, 2_147_483_648]) {
    assert.throws(() => new ConsumptionWatchdog(value, () => {}));
  }
});
