#!/usr/bin/env node
// Builds every mascot asset in assets/mascot/ from assets/mascot/sprites.json
// (and src/font.json for the wordmark lettering). Zero dependencies: SVGs are
// merged <rect> runs, PNG and ICO are encoded here, so the output is
// byte-for-byte reproducible and the JSON stays the only thing anyone edits.
//
//   node scripts/mascot.mjs           write all assets
//   node scripts/mascot.mjs --check   exit 1 if a committed asset differs from the sources
//   node scripts/mascot.mjs --card    also render social-card.png with headless Playwright

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ASSETS = path.join(ROOT, "assets", "mascot");
const PLAYWRIGHT = "playwright@1.56.1";

// ---------------------------------------------------------------- sources

export function loadSources(dir = ASSETS) {
  const read = (p) => JSON.parse(readFileSync(path.join(dir, p), "utf8"));
  return { sprites: read("sprites.json"), font: read("src/font.json") };
}

/** Throws on the first structural problem; the test suite and the generator share it. */
export function validateSprites(sprites) {
  const fail = (msg) => { throw new Error(`sprites.json: ${msg}`); };
  const { palette, legend, characters, drop } = sprites;
  for (const [name, hex] of Object.entries(palette)) if (!/^#[0-9a-f]{6}$/.test(hex)) fail(`palette.${name} is not #rrggbb`);
  for (const [ch, key] of Object.entries(legend)) {
    if (ch.length !== 1) fail(`legend key "${ch}" must be one character`);
    if (key !== null && key !== "body" && !(key in palette)) fail(`legend "${ch}" names unknown colour "${key}"`);
  }
  for (const [name, c] of Object.entries(characters)) if (!(c.body in palette)) fail(`characters.${name}.body is not a palette colour`);
  // Every grid in the file: drop poses, phase icons, and any top-level { grid } (trail, wall, props).
  const grids = [
    ...Object.entries(drop).map(([k, g]) => [`drop.${k}`, g]),
    ...phaseEntries(sprites).map(([k, g]) => [`phases.${k}`, g]),
    ...Object.entries(sprites).filter(([, v]) => v && Array.isArray(v.grid)).map(([k, v]) => [k, v.grid]),
  ];
  for (const [name, g] of grids) {
    if (!Array.isArray(g) || g.length === 0) fail(`${name} is empty`);
    const w = g[0].length;
    g.forEach((row, y) => {
      if (row.length !== w) fail(`${name} row ${y} is ${row.length} wide, expected ${w}`);
      for (const ch of row) if (!(ch in legend)) fail(`${name} row ${y} uses "${ch}", which is not in the legend`);
    });
  }
  const fav = sprites.favicon.grid;
  if (fav.length !== 16 || fav[0].length !== 16) fail("favicon must be 16x16");
  if (fav.some((row) => row.includes("o"))) fail("favicon has two characters, so it must use s/t, not the body symbol o");
  const phases = phaseEntries(sprites);
  if (phases.length !== PHASES.length || phases.some(([k], i) => k !== PHASES[i])) fail(`phases must be ${PHASES.join(", ")}, in that order`);
  for (const [k, g] of phases) {
    if (g.length !== 14 || g[0].length !== 14) fail(`phases.${k} must be 14x14`);
    if (g.some((row) => row.includes("o"))) fail(`phases.${k} belongs to no character, so it must use s/t/w, not the body symbol o`);
  }
  for (const [name, scene] of Object.entries(sprites.scenes)) {
    for (const l of scene.layers) {
      if (l.grid && !sprites[l.grid]?.grid) fail(`scenes.${name} uses unknown grid "${l.grid}"`);
      if (l.character && !characters[l.character]) fail(`scenes.${name} uses unknown character "${l.character}"`);
      if (l.character && !drop[l.pose]) fail(`scenes.${name} uses unknown pose "${l.pose}"`);
      if (l.overlay && !sprites[l.overlay]?.grid) fail(`scenes.${name} uses unknown overlay "${l.overlay}"`);
    }
    if (scene.darkEdge && !(scene.darkEdge in palette)) fail(`scenes.${name}.darkEdge is not a palette colour`);
  }
  return true;
}

/** The seven run phases, in pipeline order; sprites.json must draw exactly these. */
export const PHASES = ["inventory", "spec", "tests", "pilot", "build", "verify", "review"];
const phaseEntries = (sprites) => Object.entries(sprites.phases ?? {}).filter(([k]) => !k.startsWith("$"));

// ---------------------------------------------------------------- rasters

const raster = (w, h) => ({ w, h, px: new Array(w * h).fill(null) });

function colourOf(sprites, ch, body) {
  const key = sprites.legend[ch];
  if (key === undefined) throw new Error(`unknown grid symbol "${ch}"`);
  if (key === null) return null;
  const name = key === "body" ? body : key;
  if (!name) throw new Error(`symbol "${ch}" is the body colour, but this grid has no character`);
  return sprites.palette[name];
}

function stamp(r, sprites, grid, x0, y0, body) {
  grid.forEach((row, y) => [...row].forEach((ch, x) => {
    const c = colourOf(sprites, ch, body);
    if (c === null) return;
    const X = x0 + x, Y = y0 + y;
    if (X < 0 || Y < 0 || X >= r.w || Y >= r.h) throw new Error(`pixel (${X},${Y}) falls outside the ${r.w}x${r.h} canvas`);
    r.px[Y * r.w + X] = c;
  }));
}

function drawLayer(r, sprites, layer, { pose, dy = 0 } = {}) {
  if (layer.grid) return stamp(r, sprites, sprites[layer.grid].grid, layer.x, layer.y + dy);
  const { body } = sprites.characters[layer.character];
  stamp(r, sprites, sprites.drop[pose ?? layer.pose], layer.x, layer.y + dy, body);
  if (layer.overlay) {
    const o = sprites[layer.overlay];
    stamp(r, sprites, o.grid, layer.x + o.x, layer.y + o.y + dy, body);
  }
}

function sceneRaster(sprites, name) {
  const s = sprites.scenes[name];
  const art = raster(s.width, s.height);
  for (const l of s.layers) drawLayer(art, sprites, l);
  return art;
}

/**
 * Splits art into its silhouette edge (outline pixels that touch empty space, 8-neighbour) and the
 * rest. On dark pages #111 vanishes into the background, so only the edge is recoloured; pupils,
 * mouths and mortar sit on a fill and keep #111, which reads there.
 */
function splitEdge(r, outline) {
  const edge = raster(r.w, r.h), rest = raster(r.w, r.h);
  const empty = (x, y) => x < 0 || y < 0 || x >= r.w || y >= r.h || r.px[y * r.w + x] === null;
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
    const c = r.px[y * r.w + x];
    if (c === null) continue;
    const onEdge = c === outline && [-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => empty(x + dx, y + dy)));
    (onEdge ? edge : rest).px[y * r.w + x] = c;
  }
  return { edge, rest };
}

const recolour = (r, c) => ({ ...r, px: r.px.map((p) => (p === null ? null : c)) });

/** The art as a dark page sees it: silhouette edge in colour c instead of #111. */
function darkened(r, outline, c) {
  const { edge, rest } = splitEdge(r, outline);
  return compose(r.w, r.h, [{ r: rest, x: 0, y: 0 }, { r: recolour(edge, c), x: 0, y: 0 }]);
}

// SVG scenes with a dark edge recolour it only on dark pages. A page with its own theme toggle can
// inline the SVG and set the same rule itself.
const darkEdgeCss = (c) => `@media (prefers-color-scheme: dark){.edge g{fill:${shortHex(c)}}}`;

/** Paste rasters onto one canvas; later parts win where they overlap. */
function compose(w, h, parts) {
  const r = raster(w, h);
  for (const { r: p, x, y } of parts) p.px.forEach((c, i) => {
    if (c === null) return;
    const X = x + (i % p.w), Y = y + Math.floor(i / p.w);
    if (X < 0 || Y < 0 || X >= w || Y >= h) throw new Error(`pixel (${X},${Y}) falls outside the ${w}x${h} canvas`);
    r.px[Y * w + X] = c;
  });
  return r;
}

function gridRaster(sprites, grid) {
  const r = raster(grid[0].length, grid.length);
  stamp(r, sprites, grid, 0, 0);
  return r;
}

function layerRaster(sprites, scene, layer, opts) {
  const r = raster(scene.width, scene.height);
  drawLayer(r, sprites, layer, opts);
  return r;
}

function textRaster(face, text, ink, shadow, spacing = face.spacing) {
  const glyphs = [...text].map((ch) => {
    const g = face.glyphs[ch];
    if (!g) throw new Error(`font has no glyph for "${ch}"`);
    return g;
  });
  const w = glyphs.reduce((a, g) => a + g[0].length, 0) + spacing * (glyphs.length - 1);
  const off = shadow ? 1 : 0;
  const r = raster(w + off, face.height + off);
  const paint = (dx, dy, c) => {
    let x0 = 0;
    for (const g of glyphs) {
      g.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === "#") r.px[(y + dy) * r.w + x0 + x + dx] = c; }));
      x0 += g[0].length + spacing;
    }
  };
  if (shadow) paint(1, 1, shadow);
  paint(0, 0, ink);
  return r;
}

// ---------------------------------------------------------------- SVG

const shortHex = (c) => (/^#(.)\1(.)\2(.)\3$/.test(c) ? `#${c[1]}${c[3]}${c[5]}` : c);

/** Horizontal runs per colour, then identical runs in consecutive rows merged into one rect. */
function rects(r) {
  const byColour = new Map();
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w;) {
      const c = r.px[y * r.w + x];
      if (c === null) { x++; continue; }
      let e = x + 1;
      while (e < r.w && r.px[y * r.w + e] === c) e++;
      if (!byColour.has(c)) byColour.set(c, []);
      byColour.get(c).push({ x, y, w: e - x, h: 1 });
      x = e;
    }
  }
  const out = [];
  for (const [c, runs] of byColour) {
    const open = new Map();
    const done = [];
    for (const run of runs) {
      const k = `${run.x},${run.w}`;
      const prev = open.get(k);
      if (prev && prev.y + prev.h === run.y) prev.h++;
      else { open.set(k, run); done.push(run); }
    }
    const body = done.map((q) => `<rect x="${q.x}" y="${q.y}" width="${q.w}" height="${q.h}"/>`).join("");
    out.push(`<g fill="${shortHex(c)}">${body}</g>`);
  }
  return out.join("");
}

function svg(w, h, scale, label, inner, style = "") {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w * scale}" height="${h * scale}" shape-rendering="crispEdges" role="img" aria-label="${label}">`,
    `<title>${label}</title>`,
    style && `<style>${style}</style>`,
    inner,
    "</svg>",
    "",
  ].filter((s) => s !== "").join("\n");
}

const REDUCED = "@media (prefers-reduced-motion: reduce){.a{animation:none!important}}";
const pct = (n) => `${+n.toFixed(2)}%`;

function dripAnimSvg(sprites, label) {
  const scene = sprites.scenes.drip;
  const [blotL, trailL, blitL] = scene.layers;
  const trail = layerRaster(sprites, scene, trailL);
  const cols = sprites.trail.grid[0].length;
  const T = 4.5;
  const css = [];
  const groups = [`<g>${rects(layerRaster(sprites, scene, blotL))}</g>`];
  // The trail drips one pixel column at a time, away from Blot.
  for (let i = 0; i < cols; i++) {
    const col = raster(trail.w, trail.h);
    for (let y = 0; y < trail.h; y++) col.px[y * trail.w + trailL.x + i] = trail.px[y * trail.w + trailL.x + i];
    css.push(`.t${i}{animation:t${i} ${T}s steps(1,end) infinite}@keyframes t${i}{0%{opacity:0}${pct(4 + i * 3.2)},100%{opacity:1}}`);
    groups.push(`<g class="a t${i}">${rects(col)}</g>`);
  }
  // Blit drops in from above in 2px steps, squashes for one beat, then stands.
  css.push(
    `.fall{animation:fall ${T}s steps(1,end) infinite}`,
    "@keyframes fall{0%{opacity:0;transform:translateY(-6px)}40%{opacity:1;transform:translateY(-6px)}43%{transform:translateY(-4px)}46%{transform:translateY(-2px)}49%{opacity:0;transform:translateY(0)}55%,100%{opacity:1;transform:translateY(0)}}",
    `.land{opacity:0;animation:land ${T}s steps(1,end) infinite}`,
    "@keyframes land{0%{opacity:0}49%{opacity:1}55%,100%{opacity:0}}",
    REDUCED,
  );
  groups.push(`<g class="a fall">${rects(layerRaster(sprites, scene, blitL))}</g>`);
  groups.push(`<g class="a land">${rects(layerRaster(sprites, scene, blitL, { pose: "landLeft", dy: 1 }))}</g>`);
  return svg(scene.width, scene.height, 8, label, groups.join("\n"), css.join(""));
}

function blinkAnimSvg(sprites, label) {
  const scene = sprites.scenes.blink;
  const [blotL, blitL] = scene.layers;
  const T = 4;
  const css = [
    `.open{animation:open ${T}s steps(1,end) infinite}@keyframes open{0%{opacity:1}88%{opacity:0}92%,100%{opacity:1}}`,
    `.shut{opacity:0;animation:shut ${T}s steps(1,end) infinite}@keyframes shut{0%{opacity:0}88%{opacity:1}92%,100%{opacity:0}}`,
    REDUCED,
  ];
  const groups = [
    `<g>${rects(layerRaster(sprites, scene, blotL))}</g>`,
    `<g class="a open">${rects(layerRaster(sprites, scene, blitL, { pose: "neutral" }))}</g>`,
    `<g class="a shut">${rects(layerRaster(sprites, scene, blitL))}</g>`,
  ];
  return svg(scene.width, scene.height, 8, label, groups.join("\n"), css.join(""));
}

function eyeContactSvg(sprites, label) {
  const scene = sprites.scenes["eye-contact"];
  const [blotL, blitL] = scene.layers;
  const T = 1.2;
  // Each twin bobs 1px; Blit runs half a cycle behind, so they never rise together.
  const css = [
    `.bob{animation:bob ${T}s steps(1,end) infinite}.late{animation-delay:-${T / 2}s}`,
    "@keyframes bob{0%{transform:translateY(0)}50%,100%{transform:translateY(-1px)}}",
    REDUCED,
  ];
  const groups = [
    `<g class="a bob">${rects(layerRaster(sprites, scene, blotL))}</g>`,
    `<g class="a bob late">${rects(layerRaster(sprites, scene, blitL))}</g>`,
  ];
  return svg(scene.width, scene.height, 8, label, groups.join("\n"), css.join(""));
}

// ---------------------------------------------------------------- PNG and ICO

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])));
  return Buffer.concat([head, data, tail]);
}
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** RGBA pixels of a raster scaled up by an integer factor; null becomes transparent. */
function scaled(r, scale) {
  const w = r.w * scale, h = r.h * scale;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = r.px[Math.floor(y / scale) * r.w + Math.floor(x / scale)];
    if (c === null) continue;
    const i = (y * w + x) * 4;
    [out[i], out[i + 1], out[i + 2]] = rgb(c);
    out[i + 3] = 255;
  }
  return { w, h, rgba: out };
}

export function encodePng(w, h, rgba) {
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4); // filter 0
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA, no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const pngOf = (r, scale) => { const s = scaled(r, scale); return encodePng(s.w, s.h, s.rgba); };

/** Classic BMP-in-ICO (32bpp BGRA plus AND mask), readable back to Windows 98. */
function encodeIco(r, scales) {
  const images = scales.map((scale) => {
    const { w, h, rgba } = scaled(r, scale);
    const head = Buffer.alloc(40);
    head.writeUInt32LE(40, 0);
    head.writeInt32LE(w, 4);
    head.writeInt32LE(h * 2, 8); // XOR + AND masks stacked
    head.writeUInt16LE(1, 12);
    head.writeUInt16LE(32, 14);
    const xor = Buffer.alloc(w * h * 4);
    const maskStride = Math.ceil(w / 32) * 4;
    const and = Buffer.alloc(maskStride * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4, d = ((h - 1 - y) * w + x) * 4; // bottom-up
      xor[d] = rgba[s + 2]; xor[d + 1] = rgba[s + 1]; xor[d + 2] = rgba[s]; xor[d + 3] = rgba[s + 3];
      if (rgba[s + 3] === 0) and[(h - 1 - y) * maskStride + (x >> 3)] |= 0x80 >> (x & 7);
    }
    head.writeUInt32LE(xor.length + and.length, 20);
    return { w, h, data: Buffer.concat([head, xor, and]) };
  });
  const dir = Buffer.alloc(6 + 16 * images.length);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(images.length, 4);
  let offset = dir.length;
  images.forEach((img, i) => {
    const e = 6 + 16 * i;
    dir[e] = img.w & 0xff; dir[e + 1] = img.h & 0xff; // 0 means 256
    dir.writeUInt16LE(1, e + 4);
    dir.writeUInt16LE(32, e + 6);
    dir.writeUInt32LE(img.data.length, e + 8);
    dir.writeUInt32LE(offset, e + 12);
    offset += img.data.length;
  });
  return Buffer.concat([dir, ...images.map((i) => i.data)]);
}

// ---------------------------------------------------------------- build

/**
 * README header: the drip, then the wordmark, centred on the drip. Both variants share one size so
 * a <picture> can swap them. On dark, #111 outlines vanish and Blit's teal sinks, so the dark
 * variant draws the drip's silhouette edge in a lighter grey and inks the letters white. (A white
 * ring was tried and dropped: across the drip's 1px gaps it fused Blot, the trail and Blit into one blob.)
 */
export const HEADER = {
  text: "REMAKECRAFT",
  spacing: 2,
  gap: 7,
  scale: 4, // SVG display size; the PNG is twice that, for retina screens
  png: 8,
  light: { ink: "outline", shadow: "silver" },
  dark: { ink: "white", shadow: "teal", edge: "edge" },
};

function headerRaster(sprites, font, theme) {
  const t = HEADER[theme];
  const pal = sprites.palette;
  const drip = sceneRaster(sprites, "drip");
  const art = compose(drip.w + 2, drip.h + 2, [{ r: drip, x: 1, y: 1 }]);
  const mark = t.edge ? darkened(art, pal.outline, pal[t.edge]) : art;
  const word = textRaster(font.heavy, HEADER.text, pal[t.ink], pal[t.shadow], HEADER.spacing);
  const w = mark.w + HEADER.gap + word.w;
  return compose(w, mark.h, [
    { r: mark, x: 0, y: 0 },
    { r: word, x: mark.w + HEADER.gap, y: Math.floor((mark.h - word.h) / 2) },
  ]);
}

/** All seven phase icons side by side, 14px apart, for CSS sprites: background-position -14n px. */
function phaseSheet(sprites) {
  const icons = phaseEntries(sprites);
  return compose(14 * icons.length, 14, icons.map(([, g], i) => ({ r: gridRaster(sprites, g), x: 14 * i, y: 0 })));
}

export const CARD = {
  wordmark: { text: "Remakecraft", scale: 7 },
  tagline: { lines: ["Name an app,", "get a native rewrite."], scale: 5 },
  title: { text: "untitled - Brushling", scale: 2 },
  drip: { scale: 12 },
};

/** Every generated file, keyed by path relative to assets/mascot. Pure: same sources, same bytes. */
export function generate({ sprites, font }) {
  validateSprites(sprites);
  const files = new Map();
  const text = (p, s) => files.set(p, Buffer.from(s, "utf8"));
  const names = {
    drip: "Blot, the silver original, drips a trail of pixels that turns teal and becomes Blit, the remake",
    "eye-contact": "Blot and Blit side by side, looking at each other",
    blink: "Blot and Blit side by side; Blit blinks",
    brush: "Blot and Blit; Blit holds a paintbrush",
    blot: "Blot, a silver pixel-art paint drop",
    blit: "Blit, a teal pixel-art paint drop",
  };
  const extras = {
    wall: { label: "Blot and Blit on either side of a brick wall; Blot's trail of pixels stops at the wall", svg: 8, png: [4] },
    "blit-sleeping": { label: "Blit asleep: no run yet", svg: 4, png: [4] },
    "blit-confused": { label: "Blit looks confused: something went wrong", svg: 4, png: [4] },
  };

  const rasters = {};
  for (const name of Object.keys(names)) {
    const r = (rasters[name] = sceneRaster(sprites, name));
    text(`${name}.svg`, name === "eye-contact" ? eyeContactSvg(sprites, names[name]) : svg(r.w, r.h, 8, names[name], rects(r)));
  }
  text("drip-anim.svg", dripAnimSvg(sprites, names.drip));
  text("blink-anim.svg", blinkAnimSvg(sprites, names.blink));

  for (const s of [4, 8, 16]) files.set(`drip-${s}x.png`, pngOf(rasters.drip, s));
  files.set("blot-8x.png", pngOf(rasters.blot, 8));
  files.set("blit-8x.png", pngOf(rasters.blit, 8));

  for (const [name, o] of Object.entries(extras)) {
    const art = sceneRaster(sprites, name);
    const dark = sprites.scenes[name].darkEdge && sprites.palette[sprites.scenes[name].darkEdge];
    const { edge, rest } = splitEdge(art, sprites.palette.outline);
    const inner = dark ? `${rects(rest)}
<g class="edge">${rects(edge)}</g>` : rects(art);
    text(`${name}.svg`, svg(art.w, art.h, o.svg, o.label, inner, dark ? darkEdgeCss(dark) : ""));
    for (const s of o.png) files.set(`${name}-${s}x.png`, pngOf(art, s));
  }

  for (const theme of ["light", "dark"]) {
    const r = headerRaster(sprites, font, theme);
    text(`header-${theme}.svg`, svg(r.w, r.h, HEADER.scale, "Remakecraft", rects(r)));
    files.set(`header-${theme}-${HEADER.png}x.png`, pngOf(r, HEADER.png));
  }

  const phaseNames = { inventory: "Inventory", spec: "Spec", tests: "Tests", pilot: "Pilot", build: "Build", verify: "Verify", review: "Review" };
  for (const [name, g] of phaseEntries(sprites)) text(`phase-${name}.svg`, svg(14, 14, 2, phaseNames[name], rects(gridRaster(sprites, g))));
  const sheet = phaseSheet(sprites);
  text("phases.svg", svg(sheet.w, sheet.h, 2, `Phase icons: ${PHASES.map((p) => phaseNames[p]).join(", ")}`, rects(sheet)));
  for (const s of [1, 2]) files.set(`phases-${s}x.png`, pngOf(sheet, s));

  const fav = raster(16, 16);
  stamp(fav, sprites, sprites.favicon.grid, 0, 0);
  text("favicon.svg", svg(16, 16, 2, "Remakecraft", rects(fav)));
  for (const s of [1, 2, 3]) files.set(`favicon-${16 * s}.png`, pngOf(fav, s));
  files.set("favicon.ico", encodeIco(fav, [1, 2, 3]));

  // Pieces the social card template places; sized in CSS pixels already.
  const { white, outline } = sprites.palette;
  const part = (name, r, scale, label) => text(`src/parts/${name}.svg`, svg(r.w, r.h, scale, label, rects(r)));
  part("drip", rasters.drip, CARD.drip.scale, names.drip);
  part("wordmark", textRaster(font.heavy, CARD.wordmark.text, white, outline), CARD.wordmark.scale, CARD.wordmark.text);
  CARD.tagline.lines.forEach((line, i) => part(`tagline-${i + 1}`, textRaster(font.small, line, white), CARD.tagline.scale, line));
  part("title", textRaster(font.small, CARD.title.text, white), CARD.title.scale, CARD.title.text);
  return files;
}

/** Paths whose bytes on disk differ from a fresh build. */
export function stale(files, dir = ASSETS) {
  return [...files].filter(([p, buf]) => {
    const f = path.join(dir, p);
    return !existsSync(f) || !readFileSync(f).equals(buf);
  }).map(([p]) => p);
}

function renderCard() {
  const html = path.join(ASSETS, "src", "social-card.html");
  const out = path.join(ASSETS, "social-card.png");
  const args = ["-y", PLAYWRIGHT, "screenshot", "--browser=chromium", "--viewport-size=1280,640", "--wait-for-timeout=300", pathToFileURL(html).href, out];
  // One quoted command line: npx is a .cmd shim on Windows, which only runs through a shell.
  const res = spawnSync(`npx ${args.map((a) => `"${a}"`).join(" ")}`, { stdio: "inherit", shell: true });
  if (res.status !== 0) throw new Error(`playwright screenshot failed (exit ${res.status}); try: npx -y ${PLAYWRIGHT} install chromium-headless-shell`);
  console.log("wrote social-card.png");
}

function cli(argv) {
  const files = generate(loadSources());
  if (argv.includes("--check")) {
    const bad = stale(files);
    if (bad.length) { console.error(`stale mascot assets, run npm run mascot:\n  ${bad.join("\n  ")}`); process.exit(1); }
    console.log(`${files.size} mascot assets up to date`);
    return;
  }
  for (const [p, buf] of files) {
    const f = path.join(ASSETS, p);
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, buf);
  }
  console.log(`wrote ${files.size} files to ${path.relative(ROOT, ASSETS)}`);
  if (argv.includes("--card")) renderCard();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { cli(process.argv.slice(2)); } catch (err) { console.error(`mascot: ${err.message}`); process.exit(1); }
}
