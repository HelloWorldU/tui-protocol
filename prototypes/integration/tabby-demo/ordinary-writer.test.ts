import assert from "node:assert/strict";
import test from "node:test";
import { StreamingOrdinaryWriter } from "./ordinary-writer.ts";

test("split UTF-8 characters are decoded once without replacement characters", async () => {
  const events: string[] = [];
  const writer = new StreamingOrdinaryWriter({
    write: async text => { events.push(`write:${text}`); },
    settle: async () => { events.push("settle"); },
  });
  const bytes = new TextEncoder().encode("│");
  await writer.write(bytes.subarray(0, 1));
  await writer.write(bytes.subarray(1));
  await writer.finish();
  assert.deepEqual(events, ["settle", "write:│", "settle", "settle"]);
});

test("finish flushes an incomplete trailing sequence and preserves write-to-settle ordering", async () => {
  const events: string[] = [];
  const writer = new StreamingOrdinaryWriter({
    write: async text => { events.push(`write:${text}`); },
    settle: async () => { events.push("settle"); },
  });
  await writer.write(new TextEncoder().encode("│").subarray(0, 1));
  await writer.finish();
  assert.deepEqual(events, ["settle", "write:\uFFFD", "settle"]);
});
