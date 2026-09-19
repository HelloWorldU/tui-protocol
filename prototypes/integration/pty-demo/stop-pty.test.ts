import assert from "node:assert/strict";
import test from "node:test";
import { stopPty } from "./stop-pty.ts";

test("stopping a paused PTY requests termination before resuming its pipe for cleanup", () => {
  const calls: string[] = [];
  stopPty({ kill() { calls.push("kill"); }, resume() { calls.push("resume"); } }, error => { throw error; });
  assert.deepEqual(calls, ["kill", "resume"]);
});

test("a failed kill still attempts pipe cleanup and both thrown errors remain visible", () => {
  const errors: unknown[] = [];
  const killError = new Error("kill failed");
  const resumeError = new Error("resume failed");
  stopPty({ kill() { throw killError; }, resume() { throw resumeError; } }, error => errors.push(error));
  assert.deepEqual(errors, [killError, resumeError]);
});
