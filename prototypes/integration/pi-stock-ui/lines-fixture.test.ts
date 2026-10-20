import "./styled-test-env.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildLinesFixture } from "./lines-fixture.ts";

test("the browser lines-host fixture equals Pi's current text/lines content and layouts", () => {
  const recorded = JSON.parse(readFileSync(new URL("../xterm-lines-host/pi-lines-fixture.json", import.meta.url), "utf8"));
  assert.deepEqual(recorded, JSON.parse(JSON.stringify(buildLinesFixture())), "re-run record-lines-fixture.ts");
});
