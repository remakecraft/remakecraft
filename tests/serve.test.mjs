// The run page: state built from a run's files, the sealed holdout kept out of
// it, the overfit maths, and a server that only answers on 127.0.0.1.

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { cli, gitIn, write } from "./helpers.mjs";
import { SPEC, makeRun, publishAndBuild } from "./fixture.mjs";
import { locateRun } from "../scripts/lib/run.mjs";
import { buildState, isOverfit, makeScrubber, overfitGap, rate, readPhases } from "../scripts/lib/state.mjs";
import { HOST, mascotSymbols, serve, startServer } from "../scripts/serve.mjs";
import { controlFile, readControl } from "../scripts/control.mjs";

const SEALED_IDS = ["add.big", "mul.seven"];

/** A run that has been through one verify, with denied wall attempts aimed at the holdout. */
function scoredRun(t) {
  const run = makeRun(t);
  publishAndBuild(run);
  const r = cli("parity.mjs", [], run.root);
  assert.equal(r.code, 0, r.err + r.out);
  const wall = path.join(run.root, ".remake", "wall.log");
  const lines = [
    { at: "2026-10-13T10:00:00.000Z", role: "builder", agent: "remakecraft:builder", tool: "Read", input: { file_path: path.join(run.room, "sealed", "add.big.json") }, reason: "Clean-room wall: builders may not read the room" },
    { at: "2026-10-13T10:01:00.000Z", role: "builder", agent: "remakecraft:builder", tool: "Bash", input: { command: "cat ../Calc.remake-room/sealed/mul.seven.json" }, reason: "Clean-room wall: shell commands may not name sealed" },
    { at: "2026-10-13T10:02:00.000Z", role: "builder", agent: "remakecraft:builder", tool: "Grep", input: { pattern: "mul.seven" }, reason: "Clean-room wall: no searching for add.big" },
  ];
  write(wall, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  // A commit subject that names a sealed test must not carry it to the page either.
  write(path.join(run.root, "src", "note.txt"), "x\n");
  gitIn(run.root, "add", "src");
  gitIn(run.root, "commit", "-qm", "fix(calc.add): handle the add.big case");
  return { ...run, located: locateRun(run.root, run.root) };
}

function request(port, { method = "GET", path: p = "/", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: HOST, port, method, path: p, headers: { Host: `${HOST}:${port}`, ...headers } }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { data += c; });
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(data); } catch { /* html or empty */ }
        resolve({ status: res.statusCode, headers: res.headers, body: data, json });
      });
    });
    req.on("error", reject);
    if (body !== undefined) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}
const post = (port, body, headers = {}) => request(port, { method: "POST", path: "/api/control", headers: { "Content-Type": "application/json", ...headers }, body });

test("state is built from the run's own files", (t) => {
  const run = scoredRun(t);
  const s = buildState(run.located);

  assert.equal(s.mode, "live");
  assert.equal(s.app.name, "Calc");
  assert.equal(s.app.room, "Calc.remake-room");
  assert.equal(s.phase, "Setup", "an untouched checklist is in phase 0");
  assert.equal(s.status, "running");

  assert.equal(s.parity.overall, 71.4);
  assert.deepEqual([s.parity.passed, s.parity.total], [5, 7]);
  assert.equal(s.history.length, 1);

  const add = s.features.find((f) => f.id === "calc.add");
  const mul = s.features.find((f) => f.id === "calc.mul");
  assert.equal(add.status, "failing");
  assert.deepEqual(add.visible, { passed: 1, total: 2 });
  assert.deepEqual(add.sealed, { passed: 1, total: 1 });
  assert.equal(add.overfit, false);
  assert.deepEqual(add.tests.map((x) => [x.name, x.status]), [["add.small", "pass"], ["add.neg", "fail"]]);
  assert.deepEqual(add.spec, [["A1", "add(2,3) is 5"]]);
  assert.ok(add.commits.some((c) => c.msg.startsWith("fix(calc.add)")), "commits are matched to the feature id");

  // mul passes every visible test with a lookup table and fails the sealed one.
  assert.deepEqual(mul.visible, { passed: 3, total: 3 });
  assert.deepEqual(mul.sealed, { passed: 0, total: 1 });
  assert.equal(mul.overfit, true);
  assert.equal(mul.gap, 100);

  const pixel = s.layers.find((l) => l.key === "pixel");
  assert.equal(pixel.overfit, 1);
  assert.deepEqual(pixel.visible, { passed: 3, total: 3 });

  assert.equal(s.wall.count, 3);
  assert.equal(s.wall.entries[0].n, 3, "newest first");
  assert.equal(s.wall.entries[0].who, "builder");
  assert.equal(s.wall.entries[2].target.replace(/\\/g, "/"), "Calc.remake-room/sealed/…", "absolute paths show relative to the output folder");

  assert.equal(s.spec.state, "published", "the room draft matches the published spec");
  assert.equal(s.usage, null, "no usage file means no token or cost numbers");
  assert.ok(s.agents.some((a) => a.id === "verifier") && s.agents.some((a) => a.id === "reviewer"));
});

test("a run with nothing recorded yet comes back empty, not invented", (t) => {
  const run = makeRun(t);
  const s = buildState(locateRun(run.root, run.root));
  assert.equal(s.parity, null);
  assert.deepEqual(s.history, []);
  assert.deepEqual(s.features, []);
  assert.equal(s.usage, null);
  assert.equal(s.wall.count, 0);
  assert.equal(s.spec.state, "pending", "an unpublished draft waits for approval");
  for (const a of s.agents) assert.equal(a.tokens, null);
});

test("sealed test names never reach the state or the API", async (t) => {
  const run = scoredRun(t);
  const json = JSON.stringify(buildState(run.located));
  for (const id of SEALED_IDS) assert.ok(!json.includes(id), `${id} leaked into the state`);
  assert.ok(json.includes("sealed/…"), "paths under sealed/ are redacted");
  assert.ok(json.includes("[sealed test]"), "ids in free text are redacted");

  const s = await startServer({ run: run.located, port: 0 });
  t.after(() => s.close());
  const r = await request(s.port, { path: "/api/state" });
  assert.equal(r.status, 200);
  for (const id of SEALED_IDS) assert.ok(!r.body.includes(id), `${id} leaked over HTTP`);
});

test("the scrubber leaves look-alike names alone", () => {
  const scrub = makeScrubber(["add.big"]);
  assert.equal(scrub("add.bigger and add.big."), "add.bigger and [sealed test].");
  assert.equal(scrub("C:\\room\\sealed\\x.json"), "C:\\room\\sealed\\…");
  assert.equal(scrub("unsealed/x"), "unsealed/x");
});

test("overfit: visible beats sealed by more than 15 points", () => {
  assert.equal(rate({ passed: 2, total: 3 }), 66.6, "floored, never rounded up");
  assert.equal(rate({ passed: 0, total: 0 }), null);
  assert.equal(overfitGap({ passed: 100, total: 100 }, { passed: 85, total: 100 }), 15);
  assert.equal(isOverfit({ passed: 100, total: 100 }, { passed: 85, total: 100 }), false, "exactly 15 is not overfit");
  assert.equal(overfitGap({ passed: 1000, total: 1000 }, { passed: 849, total: 1000 }), 15.1);
  assert.equal(isOverfit({ passed: 1000, total: 1000 }, { passed: 849, total: 1000 }), true);
  assert.equal(isOverfit({ passed: 1, total: 2 }, { passed: 1, total: 1 }), false, "sealed beating visible is fine");
  assert.equal(isOverfit({ passed: 3, total: 3 }, null), false, "no sealed result, no flag");
  assert.equal(overfitGap({ passed: 3, total: 3 }, { passed: 0, total: 0 }), null);
});

test("phases come from the checklist: the first unticked line is in progress", () => {
  const p = readPhases("- [x] **0 Setup.** a\n- [x] **1 Inventory.** b\n- [ ] **2 Spec.** c\n- [ ] **3 Tests.** d\n");
  assert.deepEqual(p.map((x) => x.state), ["done", "done", "now", "future"]);
  assert.deepEqual(readPhases("- [x] **0 Setup.**\n").map((x) => x.state), ["done"]);
});

test("the server binds to 127.0.0.1 and refuses other host names", async (t) => {
  const run = scoredRun(t);
  const s = await startServer({ run: run.located, port: 0 });
  t.after(() => s.close());
  assert.equal(s.server.address().address, "127.0.0.1");
  assert.equal(s.url, `http://127.0.0.1:${s.port}/`);

  const page = await request(s.port);
  assert.equal(page.status, 200);
  assert.match(page.body, /data-mode="live"/);
  assert.match(page.headers["content-security-policy"], /frame-ancestors 'none'/);

  const rebound = await request(s.port, { path: "/api/state", headers: { Host: `evil.example:${s.port}` } });
  assert.equal(rebound.status, 421, "a rebound DNS name gets nothing");
  assert.equal((await request(s.port, { path: "/api/state", headers: { Host: `localhost:${s.port}` } })).status, 200);
});

test("the event stream sends the state on connect", async (t) => {
  const run = scoredRun(t);
  const s = await startServer({ run: run.located, port: 0 });
  t.after(() => s.close());
  const first = await new Promise((resolve, reject) => {
    const req = http.get({ host: HOST, port: s.port, path: "/api/events" }, (res) => {
      let buf = "";
      res.setEncoding("utf8");
      res.on("data", (c) => {
        buf += c;
        const m = buf.match(/event: state\ndata: (.+)\n\n/);
        if (m) { req.destroy(); resolve(JSON.parse(m[1])); }
      });
    });
    req.on("error", (e) => { if (e.code !== "ECONNRESET") reject(e); });
  });
  assert.equal(first.app.name, "Calc");
});

test("pause and resume from the page write the control file", async (t) => {
  const run = scoredRun(t);
  const s = await startServer({ run: run.located, port: 0 });
  t.after(() => s.close());

  const r = await post(s.port, { action: "pause" });
  assert.equal(r.status, 200, r.body);
  assert.equal(r.json.status, "paused");
  assert.equal(readControl(run.root).paused, true);
  assert.equal(cli("control.mjs", ["wait", "resume", "--timeout", "0"], run.root).code, 5, "still paused: wait times out");

  assert.equal((await post(s.port, { action: "resume" })).json.paused, false);
  assert.equal(cli("control.mjs", ["wait", "resume", "--timeout", "0"], run.root).code, 0);
});

test("control requests from other origins or without JSON are refused", async (t) => {
  const run = scoredRun(t);
  const s = await startServer({ run: run.located, port: 0 });
  t.after(() => s.close());
  assert.equal((await post(s.port, { action: "pause" }, { Origin: "https://evil.example" })).status, 403);
  assert.equal((await post(s.port, "action=pause", { "Content-Type": "application/x-www-form-urlencoded" })).status, 415);
  assert.equal((await post(s.port, "{nope")).status, 400);
  assert.equal((await post(s.port, { action: "delete" })).status, 400);
  assert.equal(existsSync(controlFile(run.root)), false, "nothing was written");
  assert.equal((await post(s.port, { action: "pause" }, { Origin: `http://127.0.0.1:${s.port}` })).status, 200);
});

test("a spec decision on the page binds to the exact draft", async (t) => {
  const run = scoredRun(t);
  // A revised draft in the room: one acceptance line changed.
  const v2 = structuredClone(SPEC);
  v2.version = 2;
  v2.features[1].acceptance = ["mul(2,3) is 6", "mul(7,7) is 49"];
  write(path.join(run.room, "spec", "spec.json"), v2);

  const s = await startServer({ run: run.located, port: 0 });
  t.after(() => s.close());
  const st = (await request(s.port, { path: "/api/state" })).json;
  assert.equal(st.spec.state, "pending");
  assert.equal(st.spec.version, 2);
  assert.equal(st.spec.changed, 1);
  assert.equal(st.spec.groups[0].id, "calc.mul", "changed features come first");

  assert.equal((await post(s.port, { action: "approve", hash: "stale" })).status, 400, "a stale hash is refused");
  assert.equal((await post(s.port, { action: "request", hash: st.spec.hash, note: " " })).status, 400, "changes need a note");
  assert.equal(cli("control.mjs", ["wait", "spec", "--timeout", "0"], run.root).code, 5);

  const ok = await post(s.port, { action: "request", hash: st.spec.hash, note: "Keep mul to small numbers." });
  assert.equal(ok.json.spec.state, "changes");
  const w = cli("control.mjs", ["wait", "spec", "--timeout", "0"], run.root);
  assert.equal(w.code, 6);
  assert.match(w.out, /Keep mul to small numbers\./);

  assert.equal((await post(s.port, { action: "approve", hash: st.spec.hash })).json.spec.state, "approved");
  assert.equal(cli("control.mjs", ["wait", "spec", "--timeout", "0"], run.root).code, 0);

  // A later rewrite of the draft does not inherit the approval.
  v2.features[0].acceptance.push("add(0,0) is 0");
  write(path.join(run.room, "spec", "spec.json"), v2);
  assert.equal(cli("control.mjs", ["wait", "spec", "--timeout", "0"], run.root).code, 5);
});

test("demo mode serves the simulation and no run API", async (t) => {
  const s = await startServer({ demo: true, port: 0 });
  t.after(() => s.close());
  assert.match((await request(s.port)).body, /data-mode="demo"/);
  assert.match((await request(s.port, { path: "/demo.js" })).body, /RCDemo/);
  const page = (await request(s.port)).body;
  for (const id of ["m-blit-sleeping", "m-blit-confused", "ph-inventory", "ph-build", "ph-review"]) assert.match(page, new RegExp(`<symbol id="${id}" viewBox="[0-9 ]+"`));
  assert.doesNotMatch(page, /<!--mascot-symbols-->/);
  assert.equal((await request(s.port, { path: "/api/state" })).status, 409);
  await assert.rejects(serve(["--demo", "--app", "x"]), /does not take --app/);
  await assert.rejects(serve(["--demo", "--port", "nope"]), /--port/);
});

test("control.json survives a reader: a broken file is an error, not a silent resume", (t) => {
  const run = makeRun(t);
  write(controlFile(run.root), "{broken");
  assert.throws(() => readControl(run.root), /not valid JSON/);
  write(controlFile(run.root), { paused: true, pausedAt: "2026-10-13T10:00:00.000Z" });
  assert.equal(readControl(run.root).paused, true);
  assert.match(readFileSync(controlFile(run.root), "utf8"), /paused/);
});

test("mascot symbols carry the art with a themeable edge and no OS-theme style", () => {
  const sym = mascotSymbols();
  assert.equal((sym.match(/<symbol /g) || []).length, 9);
  assert.doesNotMatch(sym, /<style>|<title>|<svg/);
  const sleeping = sym.match(/<symbol id="m-blit-sleeping"[\s\S]*?<\/symbol>/)[0];
  assert.ok(sleeping.includes('<g class="edge"><g fill="#111" style="fill:var(--mascot-edge,#111)">'), "the silhouette edge follows the page theme");
  assert.match(sleeping, /<g fill="#111"><rect/, "pupils keep their own #111");
});

/** A port nothing listens on: bind 0, read it, let it go. */
function freePort() {
  return new Promise((resolve) => {
    const s = http.createServer().listen(0, HOST, () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

test("--detach leaves the page running apart from the caller, and --stop ends it", async (t) => {
  const run = makeRun(t);
  const port = await freePort();
  const pidFile = path.join(run.root, ".remake", "serve.json");
  t.after(() => { try { process.kill(JSON.parse(readFileSync(pidFile, "utf8")).pid); } catch { /* stopped */ } });

  const up = cli("serve.mjs", ["--detach", "--port", String(port)], run.root);
  assert.equal(up.code, 0, up.err + up.out);
  assert.match(up.out, new RegExp(`http://127\\.0\\.0\\.1:${port}/`));
  assert.match(up.out, /--stop/);
  // The caller has exited; the page still answers.
  assert.equal((await request(port, { path: "/api/state" })).status, 200);
  const saved = JSON.parse(readFileSync(pidFile, "utf8"));
  assert.equal(saved.port, port);

  const again = cli("serve.mjs", ["--detach", "--port", String(port)], run.root);
  assert.equal(again.code, 0, again.err);
  assert.match(again.out, /already open/);

  const down = cli("serve.mjs", ["--stop"], run.root);
  assert.equal(down.code, 0, down.err);
  assert.match(down.out, new RegExp(`Stopped the run page on port ${port}`));
  assert.equal(existsSync(pidFile), false);
  for (let i = 0; i < 50 && await request(port, { path: "/api/state" }).then(() => true, () => false); i++) await new Promise((r) => setTimeout(r, 100));
  await assert.rejects(request(port, { path: "/api/state" }));

  const none = cli("serve.mjs", ["--stop"], run.root);
  assert.equal(none.code, 0, none.err);
  assert.match(none.out, /Nothing to stop/);
});

test("--stop takes no demo or detach flags", (t) => {
  const run = makeRun(t);
  const r = cli("serve.mjs", ["--stop", "--detach"], run.root);
  assert.equal(r.code, 2);
  assert.match(r.err, /--stop takes only --app/);
});
