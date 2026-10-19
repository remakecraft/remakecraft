// The eval fixture's docs are the only evidence a run gets about tally, so they
// must describe the hidden original exactly. Replay every observed session.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { replaySession, sessionFiles } from "../evals/fixtures/toy-original/replay.mjs";

for (const file of sessionFiles()) {
  test(`original replays ${path.basename(file)} exactly`, () => {
    assert.deepEqual(replaySession(file), []);
  });
}

test("the replayer catches a wrong implementation", () => {
  const wrong = [process.execPath, "-e", "console.log(0)"];
  assert.ok(replaySession(sessionFiles()[0], wrong).length > 0);
});
