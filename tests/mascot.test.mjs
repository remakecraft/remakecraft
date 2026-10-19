// The mascot kit is generated from assets/mascot/sprites.json. These checks keep
// the source well-formed and the committed assets in step with it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { HEADER, PHASES, generate, loadSources, stale, validateSprites } from "../scripts/mascot.mjs";

const sources = loadSources();
const clone = (o) => JSON.parse(JSON.stringify(o));
const digest = (files) => [...files].map(([p, b]) => `${p}:${createHash("sha256").update(b).digest("hex")}`).join("\n");

test("sprites.json is valid: rectangular grids, known symbols, known colours", () => {
  assert.equal(validateSprites(sources.sprites), true);
});

test("every drop pose is 14 wide, and Blit and Blot share it", () => {
  for (const [pose, grid] of Object.entries(sources.sprites.drop)) assert.equal(grid[0].length, 14, pose);
  assert.equal(sources.sprites.characters.blot.body, "silver");
  assert.equal(sources.sprites.characters.blit.body, "teal");
});

test("the drop outline is mirror-symmetric; only the highlight breaks it", () => {
  for (const [pose, grid] of Object.entries(sources.sprites.drop)) {
    grid.forEach((row, y) => {
      const shape = [...row].map((c) => (c === "." ? "." : c === "X" ? "X" : "o"));
      assert.deepEqual(shape, [...shape].reverse(), `${pose} row ${y}`);
    });
  }
});

test("validation rejects a ragged grid and an unknown symbol", () => {
  const ragged = clone(sources.sprites);
  ragged.drop.neutral[3] += ".";
  assert.throws(() => validateSprites(ragged), /row 3 is 15 wide/);
  const unknown = clone(sources.sprites);
  unknown.trail.grid[0] = unknown.trail.grid[0].replace(".", "Z");
  assert.throws(() => validateSprites(unknown), /"Z", which is not in the legend/);
  const colour = clone(sources.sprites);
  colour.legend.t = "magenta";
  assert.throws(() => validateSprites(colour), /unknown colour "magenta"/);
});

test("the generator is deterministic", () => {
  assert.equal(digest(generate(loadSources())), digest(generate(loadSources())));
});

test("committed assets match the sources (run npm run mascot after editing)", () => {
  assert.deepEqual(stale(generate(sources)), []);
});

test("PNGs and the ICO carry the right headers and sizes", () => {
  const files = generate(sources);
  const size = (p) => { const b = files.get(p); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
  assert.deepEqual(size("drip-4x.png"), [39 * 4, 23 * 4]);
  assert.deepEqual(size("drip-16x.png"), [39 * 16, 23 * 16]);
  assert.deepEqual(size("favicon-48.png"), [48, 48]);
  const ico = files.get("favicon.ico");
  assert.deepEqual([ico.readUInt16LE(2), ico.readUInt16LE(4)], [1, 3]);
  assert.deepEqual([0, 1, 2].map((i) => ico[6 + 16 * i]), [16, 32, 48]);
});

test("animated SVGs step and honour prefers-reduced-motion", () => {
  const files = generate(sources);
  for (const p of ["drip-anim.svg", "blink-anim.svg", "eye-contact.svg"]) {
    const s = files.get(p).toString();
    assert.match(s, /prefers-reduced-motion: reduce/, p);
    assert.match(s, /steps\(/, p);
    assert.doesNotMatch(s, /linear|ease/, p);
  }
  for (const [p, b] of files) if (p.endsWith(".svg")) assert.match(b.toString(), /shape-rendering="crispEdges"/, p);
});

const pngSize = (b) => [b.readUInt32BE(16), b.readUInt32BE(20)];
const viewBox = (b) => b.toString().match(/viewBox="0 0 (\d+) (\d+)"/).slice(1).map(Number);

test("header: light and dark share one size, PNGs are 2x the SVG's display size", () => {
  const files = generate(sources);
  const [w, h] = viewBox(files.get("header-light.svg"));
  assert.deepEqual(viewBox(files.get("header-dark.svg")), [w, h]);
  for (const theme of ["light", "dark"]) {
    const s = files.get(`header-${theme}.svg`).toString();
    assert.match(s, new RegExp(`width="${w * HEADER.scale}" height="${h * HEADER.scale}"`), theme);
    assert.equal(HEADER.png, HEADER.scale * 2);
    assert.deepEqual(pngSize(files.get(`header-${theme}-${HEADER.png}x.png`)), [w * HEADER.png, h * HEADER.png], theme);
  }
  for (const ch of HEADER.text) assert.ok(sources.font.heavy.glyphs[ch], `heavy face lacks "${ch}"`);
  // the dark variant inks the letters white and greys the drip's edge
  assert.notEqual(files.get("header-dark.svg").toString(), files.get("header-light.svg").toString());
});

test("wall and empty states: sizes, and a grey silhouette edge only on dark pages, never a ring", () => {
  const files = generate(sources);
  const edge = sources.sprites.palette.edge;
  for (const name of ["wall", "blit-sleeping", "blit-confused"]) {
    const { width, height } = sources.sprites.scenes[name];
    assert.deepEqual(viewBox(files.get(`${name}.svg`)), [width, height], name);
    assert.deepEqual(pngSize(files.get(`${name}-4x.png`)), [width * 4, height * 4], name);
    const s = files.get(`${name}.svg`).toString();
    assert.match(s, /<g class="edge"><g fill="#111">/, name);
    assert.ok(s.includes(`@media (prefers-color-scheme: dark){.edge g{fill:${edge}}}`), name);
    assert.doesNotMatch(s, /class="ring"/, name);
  }
});

test("dark header: no white ring; only the silhouette edge changes colour", () => {
  const files = generate(sources);
  const dark = files.get("header-dark.svg").toString();
  const light = files.get("header-light.svg").toString();
  assert.ok(dark.includes(`fill="${sources.sprites.palette.edge}"`));
  assert.ok(!light.includes(`fill="${sources.sprites.palette.edge}"`));
  // pupils and mouths sit on a fill, so they keep #111 even on dark
  assert.match(dark, /<g fill="#111">/);
  // the white in the dark header is the wordmark, eyes and highlights; a ring would add a white
  // run in the top row of the drip, which is otherwise only outline
  const firstRow = dark.match(/<g fill="#fff">(.*?)<\/g>/)[1];
  assert.doesNotMatch(firstRow, /<rect x="\d+" y="0"/);
});

test("phase icons: seven 14x14 icons in pipeline order, plus a 1x and 2x sprite sheet", () => {
  const files = generate(sources);
  assert.deepEqual(PHASES, ["inventory", "spec", "tests", "pilot", "build", "verify", "review"]);
  for (const p of PHASES) {
    const s = files.get(`phase-${p}.svg`);
    assert.ok(s, p);
    assert.deepEqual(viewBox(s), [14, 14], p);
    assert.match(s.toString(), /width="28" height="28"/, p);
  }
  assert.deepEqual(viewBox(files.get("phases.svg")), [14 * 7, 14]);
  assert.deepEqual(pngSize(files.get("phases-1x.png")), [98, 14]);
  assert.deepEqual(pngSize(files.get("phases-2x.png")), [196, 28]);
  // icons share the mascot palette and nothing else
  const allowed = new Set(Object.values(sources.sprites.palette).map((c) => (/^#(.)\1(.)\2(.)\3$/.test(c) ? `#${c[1]}${c[3]}${c[5]}` : c)));
  for (const p of PHASES) for (const [, c] of files.get(`phase-${p}.svg`).toString().matchAll(/fill="(#[0-9a-f]+)"/g)) assert.ok(allowed.has(c), `${p} uses ${c}`);
});

test("validation rejects phase icons that are missing, reordered or the wrong size", () => {
  const reordered = clone(sources.sprites);
  const { spec, ...rest } = reordered.phases;
  reordered.phases = { ...rest, spec };
  assert.throws(() => validateSprites(reordered), /phases must be inventory, spec/);
  const small = clone(sources.sprites);
  small.phases.build = small.phases.build.slice(1);
  assert.throws(() => validateSprites(small), /phases\.build must be 14x14/);
  const body = clone(sources.sprites);
  body.phases.tests[7] = body.phases.tests[7].replace("t", "o");
  assert.throws(() => validateSprites(body), /phases\.tests belongs to no character/);
});
