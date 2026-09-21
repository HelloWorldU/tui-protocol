import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { livePage } from "./multi-round/page-mode.ts";

test("the live multi-round page declares model use and removes both local-fixture test entry points", async () => {
  const html = await readFile(new URL("./multi-round/index.html", import.meta.url), "utf8");
  const live = livePage(html, "/");
  assert(live.includes("consumes plan allowance"));
  assert(!live.includes('id="native-checks"') && !live.includes('href="/checks.html"'));
  assert(live.includes('id="cancel-on-text"') && live.includes('id="send"'));
  const disabled = livePage("unused", "/checks.html");
  assert(disabled.includes("Automatic checks are disabled")); assert(!disabled.includes("script") && !disabled.includes("button"));
});

test("a changed fixture-control container prevents live serving instead of leaving automatic test buttons behind", async () => {
  const html = await readFile(new URL("./multi-round/index.html", import.meta.url), "utf8");
  assert.throws(() => livePage(html.replace('id="local-checks"', 'id="changed"'), "/"), /page changed/);
});
