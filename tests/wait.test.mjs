import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseSeconds } from "../scripts/wait.mjs";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "wait.mjs");

test("wait.mjs takes whole seconds from 1 to 120", () => {
  assert.equal(parseSeconds("30"), 30);
  for (const bad of [undefined, "", "0", "121", "1.5", "-3", "ten"]) assert.throws(() => parseSeconds(bad), /1 to 120/, String(bad));
});

test("wait.mjs waits, then says so", () => {
  assert.equal(execFileSync(process.execPath, [script, "1"], { encoding: "utf8" }), "waited 1s\n");
});
