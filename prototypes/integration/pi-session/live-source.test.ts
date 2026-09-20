import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createLiveSource } from "./live-source.ts";

test("missing or API-key-only Pi credentials cannot start the subscription trial", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-live-auth-test-"));
  const path = join(directory, "auth.json");
  try {
    await assert.rejects(createLiveSource(undefined, path), /Sign in/);
    await writeFile(path, JSON.stringify({ "openai-codex": { type: "api_key", key: "fake-test-value" } }));
    await assert.rejects(createLiveSource(undefined, path), /Sign in/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("an unknown model is rejected before creating a session or using the stored OAuth token", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-live-auth-test-"));
  const path = join(directory, "auth.json");
  try {
    await writeFile(path, JSON.stringify({ "openai-codex": {
      type: "oauth", access: "fake-test-access", refresh: "fake-test-refresh", expires: 0,
    } }));
    await assert.rejects(createLiveSource("not-a-real-model", path), /not in the pinned/);
    await assert.rejects(createLiveSource("invalid\nmodel", path), /Invalid Pi trial model/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
