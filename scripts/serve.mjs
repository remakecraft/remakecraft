#!/usr/bin/env node
// The live run page. Serves ui/run-page.html on 127.0.0.1 and a JSON state
// built only from the files the run writes (see lib/state.mjs), pushed to the
// page over server-sent events whenever one of them changes. The page's two
// controls, pause and the spec decision, are written to .remake/control.json
// for the orchestrator to read; this server never starts or stops an agent.
//
//   node scripts/serve.mjs [--app <app tree>] [--port 4317]
//   node scripts/serve.mjs --demo [--port 4317]     seeded simulation, no run needed
//   add --detach to start it apart from this session; --stop [--app] ends a detached one

import { spawn } from "node:child_process";
import http from "node:http";
import { readFileSync, rmSync, watch, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PLUGIN_ROOT, RunError, isMain, locateRun, main, parseArgs } from "./lib/run.mjs";
import { buildState, stateSignature } from "./lib/state.mjs";
import { decideSpec, setPaused } from "./control.mjs";

const USAGE = "Usage: serve.mjs [--app <app tree>] [--port 4317] [--detach] | --demo [--port 4317] [--detach] | --stop [--app <app tree>]";
export const DEFAULT_PORT = 4317;
export const HOST = "127.0.0.1";
const UI = path.join(PLUGIN_ROOT, "ui");
const POLL_MS = 1000;
const HEARTBEAT_MS = 15000;
const BODY_MAX = 16 * 1024;

const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "connect-src 'self'",
    "img-src 'self' data:",
    "frame-ancestors 'none'",
  ].join("; "),
};

const MASCOT_DIR = path.join(PLUGIN_ROOT, "assets", "mascot");
const PHASES = ["inventory", "spec", "tests", "pilot", "build", "verify", "review"];
const MASCOT_ART = ["blit-sleeping", "blit-confused", ...PHASES.map((p) => `phase-${p}`)];
const EDGE = 'fill="#111" style="fill:var(--mascot-edge,#111)"';

/**
 * The mascot art from assets/mascot as inline <symbol>s for the page's sprite,
 * so the page needs no image route and the edge colour can follow the page's
 * own theme toggle (the SVG files follow the OS theme instead).
 * Ids: m-blit-sleeping, m-blit-confused, ph-<phase>.
 */
export function mascotSymbols(dir = MASCOT_DIR) {
  return MASCOT_ART.map((name) => {
    const svg = readFileSync(path.join(dir, `${name}.svg`), "utf8");
    const viewBox = svg.match(/<svg[^>]*\sviewBox="([^"]+)"/)?.[1];
    if (!viewBox) throw new RunError(`assets/mascot/${name}.svg has no viewBox`);
    const body = svg
      .replace(/^[\s\S]*?<svg[^>]*>/, "")
      .replace(/<\/svg>\s*$/, "")
      .replace(/<title>[\s\S]*?<\/title>/, "")
      .replace(/<style>[\s\S]*?<\/style>/, "")
      .trim();
    // #111 outlines vanish on the dark page. Blit's art marks its silhouette as
    // .edge (pupils stay #111); a phase icon's #111 is all outline.
    const phase = name.startsWith("phase-");
    const themed = phase ? body.replaceAll('fill="#111"', EDGE) : body.replace('<g class="edge"><g fill="#111">', `<g class="edge"><g ${EDGE}>`);
    return `<symbol id="${phase ? "ph-" + name.slice(6) : "m-" + name}" viewBox="${viewBox}" shape-rendering="crispEdges">${themed}</symbol>`;
  }).join("\n");
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": type });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > BODY_MAX) { reject(new RunError("Request body too large", 413)); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * Starts the server. Resolves once it listens.
 * @param {{run?: {root,room,manifest}, demo?: boolean, port?: number}} opts
 */
export function startServer({ run = null, demo = false, port = DEFAULT_PORT } = {}) {
  if (!demo && !run) throw new RunError("startServer needs a run, or demo: true");
  const symbols = mascotSymbols();
  const page = readFileSync(path.join(UI, "run-page.html"), "utf8")
    .replace('data-mode="live"', `data-mode="${demo ? "demo" : "live"}"`)
    .replace("<!--mascot-symbols-->", () => symbols);
  const demoJs = readFileSync(path.join(UI, "demo.js"), "utf8");

  let state = null;
  let signature = null;
  let buildError = null;
  const clients = new Set();

  // Rebuilds the state only when an input file changed, then pushes it.
  const refresh = (force = false) => {
    if (demo) return;
    let sig;
    try { sig = stateSignature(run); } catch { sig = null; }
    if (!force && sig !== null && sig === signature && state) return;
    try {
      state = buildState(run);
      buildError = null;
    } catch (err) {
      buildError = err.message;
    }
    signature = sig;
    const payload = `event: state\ndata: ${JSON.stringify(state ?? { error: buildError })}\n\n`;
    for (const res of clients) res.write(payload);
  };

  const server = http.createServer(async (req, res) => {
    const port = server.address()?.port;
    // DNS rebinding guard: only answer to our own host names.
    const host = String(req.headers.host || "").toLowerCase();
    if (host !== `${HOST}:${port}` && host !== `localhost:${port}`) return send(res, 421, { error: "Unknown host" });
    const url = new URL(req.url, `http://${HOST}:${port}`);

    try {
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) return send(res, 200, page, "text/html; charset=utf-8");
      if (req.method === "GET" && url.pathname === "/demo.js") return send(res, 200, demoJs, "text/javascript; charset=utf-8");
      if (req.method === "GET" && url.pathname === "/favicon.ico") return send(res, 204, "");

      if (url.pathname.startsWith("/api/") && demo) return send(res, 409, { error: "The demo runs in the page; there is no run behind it." });

      if (req.method === "GET" && url.pathname === "/api/state") {
        refresh();
        return state ? send(res, 200, state) : send(res, 500, { error: buildError || "No state" });
      }

      if (req.method === "GET" && url.pathname === "/api/events") {
        res.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": "text/event-stream; charset=utf-8", Connection: "keep-alive" });
        res.write("retry: 2000\n\n");
        refresh();
        res.write(`event: state\ndata: ${JSON.stringify(state ?? { error: buildError })}\n\n`);
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/control") {
        // A page on another site can POST to localhost; only our own page may steer the run.
        const origin = req.headers.origin;
        if (origin && origin !== `http://${HOST}:${port}` && origin !== `http://localhost:${port}`) return send(res, 403, { error: "Cross-origin request refused" });
        if (!String(req.headers["content-type"] || "").startsWith("application/json")) return send(res, 415, { error: "Send JSON" });
        let body;
        try { body = JSON.parse(await readBody(req)); } catch (err) {
          return send(res, err.code === 413 ? 413 : 400, { error: err.code === 413 ? err.message : "Body is not valid JSON" });
        }
        const action = body?.action;
        if (action === "pause" || action === "resume") setPaused(run.root, action === "pause");
        else if (action === "approve" || action === "request")
          decideSpec(run.root, run.room, { decision: action === "approve" ? "approved" : "changes", hash: String(body.hash || ""), note: body.note });
        else return send(res, 400, { error: "action must be pause, resume, approve or request" });
        refresh(true);
        return send(res, 200, state);
      }

      return send(res, 404, { error: "Not found" });
    } catch (err) {
      if (err instanceof RunError) return send(res, err.code === 2 ? 400 : 500, { error: err.message });
      return send(res, 500, { error: "Unexpected error", detail: String(err.message || err) });
    }
  });

  // File watching speeds updates up where the platform supports it; the poll is the guarantee.
  const watchers = [];
  let timer = null;
  let beat = null;
  if (!demo) {
    for (const dir of [path.join(run.root, ".remake"), path.join(run.root, "spec"), path.join(run.room, "spec")]) {
      try { watchers.push(watch(dir, { recursive: true }, () => refresh())); } catch { /* missing dir or no recursive watch: polling covers it */ }
    }
    timer = setInterval(() => refresh(), POLL_MS);
  }
  beat = setInterval(() => { for (const res of clients) res.write(": keep-alive\n\n"); }, HEARTBEAT_MS);

  const close = () => new Promise((resolve) => {
    clearInterval(timer);
    clearInterval(beat);
    for (const w of watchers) w.close();
    for (const res of clients) res.end();
    clients.clear();
    server.close(() => resolve());
    server.closeAllConnections?.();
  });

  return new Promise((resolve, reject) => {
    server.once("error", (err) => {
      clearInterval(timer);
      clearInterval(beat);
      for (const w of watchers) w.close();
      if (err.code === "EADDRINUSE") reject(new RunError(`Port ${port} is in use. Is the run page already open? Pass --port to pick another.`));
      else reject(err);
    });
    server.listen(port, HOST, () => {
      const addr = server.address();
      resolve({ server, port: addr.port, url: `http://${HOST}:${addr.port}/`, close, refresh });
    });
  });
}

function readArgs(argv, cwd) {
  const { pos, flags } = parseArgs(argv, { bool: ["demo", "detach", "stop"], value: ["app", "port"] });
  if (pos.length) throw new RunError(USAGE, 2);
  const port = flags.port === undefined ? DEFAULT_PORT : Number(flags.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RunError("--port must be a whole number from 0 to 65535", 2);
  if (flags.demo && flags.app) throw new RunError("--demo plays a simulation; it does not take --app", 2);
  if (flags.stop && (flags.demo || flags.detach)) throw new RunError("--stop takes only --app", 2);
  const run = flags.demo ? null : locateRun(flags.app, cwd);
  return { flags, port, run };
}

export async function serve(argv, cwd = process.cwd()) {
  const { flags, port, run } = readArgs(argv, cwd);
  return startServer({ run, demo: Boolean(flags.demo), port });
}

// --detach: Claude Code stops a background command after two hours, and the page
// went with it mid-run. A detached server belongs to no session; its pid and port
// sit in .remake/serve.json for --stop.
const pidFile = (run) => path.join(run.root, ".remake", "serve.json");
const DETACH_WAIT_MS = 10000;

async function pageUp(port) {
  try { return (await fetch(`http://${HOST}:${port}/api/state`, { signal: AbortSignal.timeout(1000) })).status < 500; }
  catch { return false; }
}

export async function detach(argv, cwd = process.cwd()) {
  const { flags, port, run } = readArgs(argv, cwd);
  const url = `http://${HOST}:${port}/`;
  if (await pageUp(port)) return { url, pid: null, already: true };
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...argv.filter((a) => a !== "--detach")], {
    cwd, detached: true, stdio: "ignore", windowsHide: true,
  });
  child.unref();
  for (const t0 = Date.now(); Date.now() - t0 < DETACH_WAIT_MS;) {
    if (child.exitCode !== null) throw new RunError(`The run page exited at once (code ${child.exitCode}). Run serve.mjs without --detach to see why.`);
    if (await pageUp(port)) {
      if (run) writeFileSync(pidFile(run), JSON.stringify({ pid: child.pid, port, demo: Boolean(flags.demo) }) + "\n");
      return { url, pid: child.pid, already: false };
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  try { process.kill(child.pid); } catch { /* already gone */ }
  throw new RunError(`The run page did not answer on ${url} within ${DETACH_WAIT_MS / 1000} s.`);
}

export function stopDetached(argv, cwd = process.cwd()) {
  const { run } = readArgs(argv, cwd);
  if (!run) throw new RunError("--stop needs a run: pass --app or run it from the app tree", 2);
  let saved;
  try { saved = JSON.parse(readFileSync(pidFile(run), "utf8")); }
  catch (err) {
    if (err.code === "ENOENT") return { stopped: false, why: "no detached run page for this run" };
    throw new RunError(`Could not read ${pidFile(run)}: ${err.message}`);
  }
  rmSync(pidFile(run), { force: true });
  try { process.kill(saved.pid); return { stopped: true, port: saved.port }; }
  catch (err) {
    if (err.code === "ESRCH") return { stopped: false, why: `the page (pid ${saved.pid}) had already stopped` };
    throw new RunError(`Could not stop pid ${saved.pid}: ${err.message}`);
  }
}

if (isMain(import.meta.url)) {
  main(async () => {
    const argv = process.argv.slice(2);
    if (argv.includes("--stop")) {
      const r = stopDetached(argv);
      process.stdout.write(r.stopped ? `Stopped the run page on port ${r.port}.\n` : `Nothing to stop: ${r.why}.\n`);
      return;
    }
    if (argv.includes("--detach")) {
      const r = await detach(argv);
      process.stdout.write(r.already
        ? `Remakecraft run page is already open: ${r.url}\n`
        : `Remakecraft run page: ${r.url}\nDetached (pid ${r.pid}), on 127.0.0.1 only. It keeps running after this session; stop it with serve.mjs --stop.\n`);
      return;
    }
    const s = await serve(argv);
    process.stdout.write(`Remakecraft run page: ${s.url}\nServing on 127.0.0.1 only. Ctrl+C stops it; the run carries on without it.\n`);
    const stop = () => s.close().then(() => process.exit(0));
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    await new Promise(() => {}); // keep the process alive until a signal
  });
}
