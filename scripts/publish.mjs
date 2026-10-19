#!/usr/bin/env node
// Moves approved work from the room into the app tree, the only way anything
// crosses the wall. `spec` publishes the functional spec after the human
// checkpoint; `tests` publishes the visible tests and records the hashes that
// parity.mjs later checks the yardstick against. In a run started --with-rea
// both also pass the code filter (lib/codefilter.mjs): exit 9 names each line.
//
//   node scripts/publish.mjs spec|tests [--app <app tree>]

import { existsSync, copyFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import {
  LAYERS, PRIORITIES, RunError, copyDir, gitCommit, hashFile, hashTree, isMain, listFiles, locateRun, main, parseArgs, readJson, toSlash, writeJson,
} from "./lib/run.mjs";
import { reaNames, readDocs, scanDocs } from "./lib/codefilter.mjs";

const USAGE = "Usage: publish.mjs spec|tests [--app <app tree>]";
const ID = /^[a-z0-9][a-z0-9._-]*$/;
const SEALED_TARGET = 0.3;
const SEALED_RANGE = [0.2, 0.4];
// Where an inventory item or a feature came from: watching the app run, or REA reading its code.
export const SOURCES = ["watched", "rea"];
const CODE_FOUND = 9;

/**
 * The inventory's "withheld" list: things the evidence says that must never
 * cross the wall, recorded by the observer. Implementation details (variable
 * and function names, temp files, write strategy) and expression (taglines,
 * banners, jokes). Returns [{ text, why }] with blank or malformed entries reported.
 */
export function readWithheld(inventory) {
  const list = inventory?.withheld;
  if (list === undefined) return { items: [], errors: [] };
  if (!Array.isArray(list)) return { items: [], errors: [`inventory.json: "withheld" must be a list of { text, why }`] };
  const items = [];
  const errors = [];
  for (const [i, w] of list.entries()) {
    const text = typeof w === "string" ? w : w?.text;
    if (typeof text !== "string" || text.trim().length < 2) errors.push(`inventory.json: withheld #${i + 1} needs a "text" of at least 2 characters`);
    else items.push({ text: text.trim(), why: typeof w === "object" && w?.why ? String(w.why) : "" });
  }
  return { items, errors };
}

/**
 * Finds withheld text in documents headed for the app tree. Case-insensitive;
 * an end that is a word character must sit on a word boundary, so withholding
 * "hist" does not trip on "history". Returns one "<doc>: \"text\" (why)" per hit.
 */
export function findWithheld(withheld, docs) {
  const hits = [];
  for (const { text, why } of withheld) {
    const esc = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`${/^\w/.test(text) ? "\\b" : ""}${esc}${/\w$/.test(text) ? "\\b" : ""}`, "i");
    for (const [name, body] of docs) if (re.test(body)) hits.push(`${name}: "${text}"${why ? ` (${why})` : ""}`);
  }
  return hits;
}

/** Checks spec.json; with an inventory, every inventory id must land in exactly one feature. */
export function validateSpec(spec, inventory = null, docs = null) {
  const errors = [];
  if (!spec || typeof spec !== "object") throw new RunError("spec.json must be a JSON object");
  if (!Number.isInteger(spec.version) || spec.version < 1) errors.push(`"version" must be a positive integer`);
  if (!Array.isArray(spec.features) || !spec.features.length) errors.push(`"features" must be a non-empty array`);
  const seen = new Set();
  for (const [i, f] of (Array.isArray(spec.features) ? spec.features : []).entries()) {
    const at = f && typeof f.id === "string" && f.id ? `feature "${f.id}"` : `feature #${i + 1}`;
    if (!f || typeof f !== "object") { errors.push(`${at} is not an object`); continue; }
    if (typeof f.id !== "string" || !ID.test(f.id)) errors.push(`${at}: "id" must be lowercase and dotted, e.g. tool.fill`);
    else if (seen.has(f.id)) errors.push(`${at}: duplicate id`);
    else seen.add(f.id);
    if (!LAYERS.includes(f.layer)) errors.push(`${at}: "layer" must be one of ${LAYERS.join(", ")}`);
    if (!PRIORITIES.includes(f.priority)) errors.push(`${at}: "priority" must be one of ${PRIORITIES.join(", ")}`);
    if (!Array.isArray(f.acceptance) || !f.acceptance.length || !f.acceptance.every((a) => typeof a === "string" && a.trim()))
      errors.push(`${at}: "acceptance" must be a non-empty list of checks`);
    if (f.inventory !== undefined && (!Array.isArray(f.inventory) || !f.inventory.every((x) => typeof x === "string")))
      errors.push(`${at}: "inventory" must be a list of inventory ids`);
    if (f.source !== undefined && !SOURCES.includes(f.source)) errors.push(`${at}: "source" must be one of ${SOURCES.join(", ")}`);
  }

  if (inventory) {
    if (!Array.isArray(inventory.items)) errors.push(`inventory.json: "items" must be an array`);
    else {
      for (const it of inventory.items)
        if (it?.source !== undefined && !SOURCES.includes(it.source)) errors.push(`inventory item "${it.id}": "source" must be one of ${SOURCES.join(", ")}`);
      const owners = new Map(inventory.items.map((it) => [it?.id, []]));
      for (const f of spec.features || []) {
        for (const inv of f?.inventory || []) {
          if (!owners.has(inv)) errors.push(`feature "${f.id}" covers "${inv}", which is not in inventory.json`);
          else owners.get(inv).push(f.id);
        }
      }
      const missing = [...owners].filter(([, o]) => o.length === 0).map(([id]) => id);
      const doubled = [...owners].filter(([, o]) => o.length > 1);
      if (missing.length) errors.push(`${missing.length} inventory id(s) covered by no feature: ${missing.join(", ")}`);
      for (const [id, o] of doubled) errors.push(`inventory id "${id}" is covered by ${o.length} features (${o.join(", ")}); it needs exactly one`);
    }
  }
  if (inventory) {
    // Withheld text may not appear even to rule it out: naming an internal in a
    // non-goal still hands it to the builders.
    const { items, errors: bad } = readWithheld(inventory);
    errors.push(...bad);
    const docsToScan = docs || [["spec.json", JSON.stringify(spec)]];
    for (const hit of findWithheld(items, docsToScan)) errors.push(`withheld text in ${hit}; describe the behaviour without it`);
  }
  if (errors.length) throw new RunError(`spec.json does not validate:\n  - ${errors.join("\n  - ")}`);
  return spec;
}

/** Checks the test manifest against the spec. Returns warnings; throws on errors. */
export function validateTests(manifest, spec, { visibleDir, sealedDir } = {}) {
  const errors = [];
  const warnings = [];
  if (!manifest || !Array.isArray(manifest.tests) || !manifest.tests.length) throw new RunError(`tests/manifest.json: "tests" must be a non-empty array`);
  const features = new Map(spec.features.map((f) => [f.id, { visible: 0, sealed: 0 }]));
  const ids = new Set();
  for (const [i, t] of manifest.tests.entries()) {
    const at = t && typeof t.id === "string" && t.id ? `test "${t.id}"` : `test #${i + 1}`;
    if (!t || typeof t !== "object") { errors.push(`${at} is not an object`); continue; }
    if (typeof t.id !== "string" || !t.id.trim()) errors.push(`${at}: "id" must be a non-empty string`);
    else if (ids.has(t.id)) errors.push(`${at}: duplicate id`);
    else ids.add(t.id);
    if (!features.has(t.feature)) errors.push(`${at}: feature "${t.feature}" is not in the spec`);
    if (t.layer !== undefined && !LAYERS.includes(t.layer)) errors.push(`${at}: "layer" must be one of ${LAYERS.join(", ")}`);
    if (t.set !== "visible" && t.set !== "sealed") { errors.push(`${at}: "set" must be "visible" or "sealed"`); continue; }
    if (t.file !== undefined) {
      const dir = t.set === "visible" ? visibleDir : sealedDir;
      if (typeof t.file !== "string" || (dir && !existsSync(path.join(dir, t.file))))
        errors.push(`${at}: file "${t.file}" is not in the room's ${t.set === "visible" ? "tests/visible" : "sealed"}/`);
    }
    if (features.has(t.feature)) features.get(t.feature)[t.set]++;
  }
  for (const [id, n] of features) {
    if (!n.visible) errors.push(`feature "${id}" has no visible test`);
    if (!n.sealed) errors.push(`feature "${id}" has no sealed test`);
  }
  if (errors.length) throw new RunError(`tests/manifest.json does not validate:\n  - ${errors.join("\n  - ")}`);

  const sealed = manifest.tests.filter((t) => t.set === "sealed").length;
  const share = sealed / manifest.tests.length;
  if (share < SEALED_RANGE[0] || share > SEALED_RANGE[1])
    warnings.push(`sealed share is ${Math.round(share * 100)}% (${sealed} of ${manifest.tests.length}); aim for about ${SEALED_TARGET * 100}%`);
  return { warnings, total: manifest.tests.length, sealed };
}

/** True when the observer read the original's code, so what crosses must be filtered for it. */
const filtersCode = (manifest) => manifest.rea === true && manifest.mode !== "open";

/** Refuses documents that still carry code, one file:line per hit. */
function refuseCode(what, docs, room, inventory, prose) {
  const hits = scanDocs(docs, { prose, reaNames: reaNames(room, inventory) });
  if (hits.length)
    throw new RunError(
      `${what} carries code from the original (this run was started --with-rea). Describe the behaviour instead:\n  - ${hits.join("\n  - ")}`,
      CODE_FOUND,
    );
}

function publishSpec({ root, room, manifest }) {
  const src = path.join(room, "spec");
  const spec = readJson(path.join(src, "spec.json"), "The room's spec/spec.json");
  if (!existsSync(path.join(src, "spec.md"))) throw new RunError(`spec.md is missing from ${toSlash(src)}. Render it from spec.json first.`);
  const invFile = path.join(room, "inventory.json");
  const docs = ["spec.json", "spec.md"].map((f) => [f, readFileSync(path.join(src, f), "utf8")]);
  const inventory = existsSync(invFile) ? readJson(invFile, "inventory.json") : null;
  validateSpec(spec, inventory, docs);
  if (filtersCode(manifest)) {
    const untagged = (inventory?.items || []).filter((it) => !SOURCES.includes(it?.source)).map((it) => it?.id);
    if (untagged.length) throw new RunError(`In a run started --with-rea every inventory item needs "source": "watched" or "rea". Missing: ${untagged.join(", ")}`);
    refuseCode("The spec", docs, room, inventory, true);
  }

  const dest = path.join(root, "spec");
  mkdirSync(dest, { recursive: true });
  for (const f of ["spec.json", "spec.md"]) copyFileSync(path.join(src, f), path.join(dest, f));

  // Keep statuses of features that survive a republish; new ones start pending.
  const progressFile = path.join(root, ".remake", "progress", "features.json");
  const before = existsSync(progressFile) ? new Map(readJson(progressFile).map((f) => [f.id, f])) : new Map();
  writeJson(progressFile, spec.features.map((f) => ({ id: f.id, priority: f.priority, layer: f.layer, status: before.get(f.id)?.status ?? "pending" })));

  // A republished spec invalidates the recorded spec hashes; refresh them so
  // parity does not flag the human's own change as tampering.
  const hashesFile = path.join(room, "hashes.json");
  const notes = [];
  if (existsSync(hashesFile)) {
    const h = readJson(hashesFile);
    const app = Object.fromEntries(Object.entries(h.app || {}).filter(([k]) => !k.startsWith("spec/")));
    writeJson(hashesFile, { ...h, app: { ...app, ...hashTree(root, "spec") }, updatedAt: new Date().toISOString() });
    notes.push("Spec hashes refreshed. If acceptance lines changed, rerun the test-writer and publish tests again.");
  }
  const sha = gitCommit(root, `spec: publish v${spec.version}`, ["spec"]);
  const by = (p) => spec.features.filter((f) => f.priority === p).length;
  return {
    lines: [
      `Published spec v${spec.version}: ${spec.features.length} features (must ${by("must")}, should ${by("should")}, could ${by("could")}).`,
      sha ? `Committed ${sha} in ${toSlash(root)}.` : "Spec unchanged since the last publish; nothing to commit.",
      ...notes,
    ],
  };
}

function publishTests({ root, room, manifest: cfg }) {
  const roomSpecFile = path.join(room, "spec", "spec.json");
  const appSpecFile = path.join(root, "spec", "spec.json");
  if (!existsSync(appSpecFile)) throw new RunError("The spec is not published yet. Run publish.mjs spec first.");
  if (hashFile(roomSpecFile) !== hashFile(appSpecFile))
    throw new RunError("The room's spec changed after it was published. Publish the spec again (after the human checkpoint), then the tests.");
  const spec = readJson(appSpecFile);

  const visibleSrc = path.join(room, "tests", "visible");
  const sealedSrc = path.join(room, "sealed");
  if (!listFiles(visibleSrc).length) throw new RunError(`No visible tests in ${toSlash(visibleSrc)}`);
  if (!listFiles(sealedSrc).length) throw new RunError(`No sealed tests in ${toSlash(sealedSrc)}`);
  const manifest = readJson(path.join(room, "tests", "manifest.json"), "The room's tests/manifest.json");
  const { warnings, total, sealed } = validateTests(manifest, spec, { visibleDir: visibleSrc, sealedDir: sealedSrc });
  // Tests are written from the spec alone, but check anyway: visible tests cross the wall.
  const invFile = path.join(room, "inventory.json");
  if (existsSync(invFile)) {
    const { items } = readWithheld(readJson(invFile, "inventory.json"));
    const docs = [[visibleSrc, "tests/visible"], [sealedSrc, "sealed"]].flatMap(([dir, label]) =>
      listFiles(dir).map((f) => [`${label}/${toSlash(path.relative(dir, f))}`, readFileSync(f, "utf8")]));
    const hits = findWithheld(items, docs);
    if (hits.length) throw new RunError(`Tests contain withheld text:\n  - ${hits.join("\n  - ")}`);
  }
  // Only the visible tests reach the builders; the sealed ones stay in the room.
  if (filtersCode(cfg))
    refuseCode("The visible tests", readDocs(visibleSrc, "tests/visible"), room, existsSync(invFile) ? readJson(invFile, "inventory.json") : null, false);

  // Replace, not merge: a test the writer dropped must not linger in the app tree.
  const dest = path.join(root, "tests", "visible");
  rmSync(dest, { recursive: true, force: true });
  copyDir(visibleSrc, dest);

  // The hashes live in the room so a builder can neither read nor rewrite them.
  writeJson(path.join(room, "hashes.json"), {
    version: 1,
    createdAt: new Date().toISOString(),
    app: { ...hashTree(root, "spec"), ...hashTree(root, "tests/visible") },
    room: hashTree(room, "sealed"),
  });
  const sha = gitCommit(root, `tests: publish ${total - sealed} visible tests`, ["tests/visible"]);
  return {
    lines: [
      ...warnings.map((w) => `Warning: ${w}`),
      `Published ${total - sealed} visible tests; ${sealed} sealed tests stay in the room. Hashes recorded for both sets.`,
      sha ? `Committed ${sha} in ${toSlash(root)}.` : "Visible tests unchanged since the last publish; nothing to commit.",
    ],
  };
}

export function publish(argv, cwd = process.cwd()) {
  const { pos, flags } = parseArgs(argv, { value: ["app"] });
  if (pos.length !== 1 || !["spec", "tests"].includes(pos[0])) throw new RunError(USAGE, 2);
  const run = locateRun(flags.app, cwd);
  return pos[0] === "spec" ? publishSpec(run) : publishTests(run);
}

if (isMain(import.meta.url)) {
  main(() => {
    process.stdout.write(publish(process.argv.slice(2)).lines.join("\n") + "\n");
  });
}
