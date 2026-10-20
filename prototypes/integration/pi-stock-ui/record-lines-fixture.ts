// Writes Pi's text/lines fixture for the browser lines-host checks, which
// cannot run Pi's renderer. lines-fixture.test.ts fails when it is stale.
//   node prototypes/integration/pi-stock-ui/record-lines-fixture.ts
import "./styled-test-env.ts";
import { writeFileSync } from "node:fs";
import { buildLinesFixture } from "./lines-fixture.ts";

const target = new URL("../xterm-lines-host/pi-lines-fixture.json", import.meta.url);
writeFileSync(target, `${JSON.stringify(buildLinesFixture(), null, 1)}\n`, "utf8");
console.log(`Wrote ${target.pathname}`);
