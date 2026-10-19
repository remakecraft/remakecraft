#!/usr/bin/env node
// tally: the "original app" the evals clone. Hidden from every agent in a run;
// only ../docs is handed over as evidence. tests/tally-fixture.test.mjs replays
// the docs' observed sessions against this file so docs and behaviour agree.
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";

const FILE = ".tally";
const MAX_UNDO = 10;
const USAGE = "usage: tally [show | add [n] | sub [n] | reset | undo | help]\n";
const fail = (code, msg) => { process.stderr.write(`tally: ${msg}\n`); process.exit(code); };

function load() {
  if (!existsSync(FILE)) return { value: 0, hist: [] };
  const text = readFileSync(FILE, "utf8");
  const lines = text.endsWith("\n") ? text.slice(0, -1).split("\n") : null;
  const nums = lines?.slice(1) ?? [];
  if (!lines || lines[0] !== "tally 1" || nums.length < 1 || nums.length > MAX_UNDO + 1 || !nums.every((n) => /^(0|[1-9][0-9]*)$/.test(n)))
    fail(3, `save file ${FILE} is damaged`);
  const [value, ...hist] = nums.map(Number);
  return { value, hist };
}

function flushState(s) {
  writeFileSync(FILE + ".tmp", ["tally 1", s.value, ...s.hist].join("\n") + "\n");
  renameSync(FILE + ".tmp", FILE);
}

function amount(arg) {
  if (arg === undefined) return 1;
  if (!/^[1-9][0-9]{0,5}$/.test(arg)) fail(2, "amount must be a whole number from 1 to 999999");
  return Number(arg);
}

const [cmd = "show", ...args] = process.argv.slice(2);
const takes = { show: 0, add: 1, sub: 1, reset: 0, undo: 0, help: 0, "--help": 0, "-h": 0 };
if (!Object.hasOwn(takes, cmd)) fail(2, `unknown command '${cmd}' (try 'tally help')`);
if (args.length > takes[cmd]) fail(2, "too many arguments");
if (["help", "--help", "-h"].includes(cmd)) { process.stdout.write(USAGE); process.exit(0); }
const n = takes[cmd] ? amount(args[0]) : 0;

const s = load();
let next = s.value;
if (cmd === "add") next = s.value + n;
if (cmd === "sub") next = Math.max(0, s.value - n);
if (cmd === "reset") next = 0;
if (cmd === "undo") {
  if (s.hist.length === 0) fail(1, "nothing to undo");
  next = s.hist.pop();
  flushState({ value: next, hist: s.hist });
} else if (next !== s.value) {
  flushState({ value: next, hist: [...s.hist, s.value].slice(-MAX_UNDO) });
}
process.stdout.write(`${next}\n`);
