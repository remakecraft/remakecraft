// Demo mode for the run page (serve.mjs --demo): a seeded simulation of a
// Brushling run mid-build, for recordings. It produces the same state shape
// the server builds from a real run, so the page renders it with the same
// code. Every number here is simulated; live mode never loads this file.
(() => {
'use strict';

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rng = mulberry32(0xDA0B98);
const ri = (a, b) => a + Math.floor(rng() * (b - a + 1));
const pick = a => a[Math.floor(rng() * a.length)];
const hex = n => { let s = ''; for (let i = 0; i < n; i++) s += '0123456789abcdef'[Math.floor(rng() * 16)]; return s; };

const LAYER = { b: 'behaviour', p: 'pixel', f: 'format', u: 'ui' };
const PRIO = { m: 'must', s: 'should', c: 'could' };
const RAW = `tool.select.free|Free-form select|b|m
tool.select.rect|Rectangle select|b|m
tool.eraser|Eraser and color eraser|p|m
tool.fill|Fill with color|p|m
tool.pick|Pick color|b|m
tool.magnifier|Magnifier|b|s
tool.pencil|Pencil|p|m
tool.brush|Brush|p|m
tool.airbrush|Airbrush|p|s
tool.text|Text|b|s
tool.line|Line|p|m
tool.curve|Curve|p|s
tool.rect|Rectangle|p|m
tool.polygon|Polygon|p|s
tool.ellipse|Ellipse|p|m
tool.rounded-rect|Rounded rectangle|p|c
tool.select.opaque|Opaque selection|b|s
tool.select.transparent|Transparent selection|b|s
tool.eraser.size|Eraser sizes|p|s
tool.brush.shapes|Brush shapes|p|s
tool.airbrush.size|Airbrush sizes|p|c
tool.line.width|Line widths|p|m
tool.shape.fill-style|Outline and fill styles|b|m
tool.text.toolbar|Fonts toolbar|u|c
tool.pencil.shift|Shift-constrained strokes|b|c
tool.right-click|Right button paints background|b|m
menu.file.new|File › New|b|m
menu.file.open|File › Open|b|m
menu.file.save|File › Save|b|m
menu.file.save-as|File › Save As|b|m
menu.file.print-preview|File › Print Preview|u|c
menu.file.page-setup|File › Page Setup|u|c
menu.file.print|File › Print|b|c
menu.file.wallpaper|Set as wallpaper|b|c
menu.file.recent|Recent files|b|s
menu.file.exit|File › Exit|b|m
menu.edit.undo|Edit › Undo, three levels|b|m
menu.edit.repeat|Edit › Repeat|b|m
menu.edit.cut|Edit › Cut|b|m
menu.edit.copy|Edit › Copy|b|m
menu.edit.paste|Edit › Paste|b|m
menu.edit.clear-selection|Edit › Clear Selection|b|m
menu.edit.select-all|Edit › Select All|b|m
menu.edit.copy-to|Edit › Copy To|b|s
menu.edit.paste-from|Edit › Paste From|b|s
menu.view.toolbox|View › Tool Box|u|m
menu.view.colorbox|View › Color Box|u|m
menu.view.statusbar|View › Status Bar|u|m
menu.view.text-toolbar|View › Text Toolbar|u|c
menu.view.zoom.custom|View › Zoom › Custom|b|s
menu.view.zoom.grid|View › Zoom › Show Grid|p|s
menu.view.zoom.thumbnail|View › Zoom › Thumbnail|u|c
menu.view.bitmap|View › View Bitmap|b|s
menu.image.flip|Image › Flip and rotate|b|m
menu.image.rotate|Rotate by 90, 180, 270|p|m
menu.image.stretch|Image › Stretch|p|s
menu.image.skew|Image › Skew|p|c
menu.image.invert|Image › Invert Colors|p|m
menu.image.attributes|Image › Attributes|b|m
menu.image.clear|Image › Clear Image|b|m
menu.image.draw-opaque|Image › Draw Opaque|b|s
menu.colors.edit|Colors › Edit Colors|b|m
menu.help.topics|Help › Help Topics|u|c
menu.help.about|Help › About|u|c
shortcut.ctrl-z|Ctrl+Z undo|b|m
shortcut.ctrl-y|Ctrl+Y repeat|b|m
shortcut.ctrl-a|Ctrl+A select all|b|m
shortcut.ctrl-c|Ctrl+C copy|b|m
shortcut.ctrl-x|Ctrl+X cut|b|m
shortcut.ctrl-v|Ctrl+V paste|b|m
shortcut.ctrl-n|Ctrl+N new|b|m
shortcut.ctrl-o|Ctrl+O open|b|m
shortcut.ctrl-s|Ctrl+S save|b|m
shortcut.ctrl-p|Ctrl+P print|b|c
shortcut.ctrl-e|Ctrl+E attributes|b|s
shortcut.ctrl-r|Ctrl+R flip and rotate|b|s
shortcut.ctrl-w|Ctrl+W stretch and skew|b|s
shortcut.ctrl-i|Ctrl+I invert colors|b|s
shortcut.ctrl-t|Ctrl+T tool box|b|c
shortcut.ctrl-f|Ctrl+F view bitmap|b|c
shortcut.ctrl-g|Ctrl+G show grid|b|c
shortcut.ctrl-pgup|Ctrl+PgUp large size|b|s
shortcut.ctrl-pgdn|Ctrl+PgDn normal size|b|s
shortcut.del|Del clears selection|b|m
shortcut.ctrl-shift-n|Ctrl+Shift+N clear image|b|s
format.bmp.1|Monochrome bitmap|f|m
format.bmp.4|16-color bitmap|f|m
format.bmp.8|256-color bitmap|f|m
format.bmp.24|24-bit bitmap|f|m
format.bmp.rle|RLE-compressed bitmap read|f|c
format.bmp.palette|Palette quantising on save|f|s
format.png|PNG through filter|f|s
format.jpeg|JPEG through filter|f|s
format.gif|GIF through filter|f|c
format.ico|Icon read|f|c
format.clipboard.dib|Clipboard DIB|f|m
canvas.zoom.1x|Zoom 1×|p|m
canvas.zoom.2x|Zoom 2×|p|s
canvas.zoom.4x|Zoom 4×|p|m
canvas.zoom.6x|Zoom 6×|p|s
canvas.zoom.8x|Zoom 8×|p|s
canvas.grid|Pixel grid at 4× and up|p|s
canvas.resize-handles|Canvas resize handles|b|m
canvas.scroll|Scrolling past the window|b|m
canvas.thumbnail|Thumbnail window|u|c
canvas.status.coords|Status bar coordinates|u|s
canvas.status.size|Status bar selection size|u|s
canvas.cursor|Tool cursors|u|s
dialog.attributes|Attributes dialog|u|m
dialog.flip-rotate|Flip and Rotate dialog|u|m
dialog.stretch-skew|Stretch and Skew dialog|u|s
dialog.edit-colors|Edit Colors dialog|u|m
dialog.custom-zoom|Custom Zoom dialog|u|s
dialog.save-changes|Save changes prompt|u|m
dialog.open|Open dialog|u|m
dialog.save-as|Save As dialog|u|m
dialog.page-setup|Page Setup dialog|u|c
colors.palette.default|Default 28-color palette|p|m
colors.fg-bg|Foreground and background picking|b|m
colors.custom|Custom colors|b|s
colors.palette.save|Save and load palette|f|c`;

const VERBS = {
  p: ['matches_reference_1x', 'matches_reference_at_4x', 'respects_line_width', 'clips_at_canvas_edge', 'left_drag_uses_foreground', 'right_drag_uses_background', 'no_antialiasing', 'undo_restores_pixels', 'xor_preview_while_dragging'],
  b: ['opens_from_menu', 'shortcut_triggers', 'undo_round_trip', 'disabled_without_selection', 'state_survives_tool_switch', 'escape_cancels', 'status_bar_updates', 'repeat_applies_again'],
  f: ['round_trip_is_lossless', 'header_fields_match', 'palette_order_kept', 'rows_padded_to_4_bytes', 'rows_stored_bottom_up', 'rejects_truncated_file', 'opens_reference_corpus'],
  u: ['layout_matches_reference', 'tab_order', 'enter_is_default_button', 'escape_cancels', 'rejects_non_numeric_input', 'accelerator_keys_work']
};
const SPEC_TPL = {
  p: t => [`${t} draws with hard pixel edges; no antialiasing at any zoom.`, `The left button uses the foreground color and the right button the background color.`, `Output is compared pixel for pixel with captures from the original at 1× and 4×.`, `One completed stroke or shape is one undo step.`],
  b: t => [`${t} behaves as in the original, including the state of the menu item when it does not apply.`, `The keyboard accelerator does the same thing as the menu item.`, `The action can be undone, and Repeat applies it again where the original allows.`],
  f: t => [`${t}: files written by the original open with identical pixels.`, `Files Brushling writes open in the original without a warning.`, `Malformed input shows the original's error text and leaves the canvas untouched.`],
  u: t => [`${t} matches the original's control layout, labels and access keys.`, `Enter triggers the default button and Esc cancels.`, `Numeric fields reject values outside the original's range with its message.`]
};
const OVERRIDE = {
  'tool.fill': {
    tests: ['fill_floods_4_connected_region', 'fill_does_not_leak_through_diagonal', 'fill_right_click_uses_background', 'fill_same_color_is_noop', 'fill_respects_canvas_bounds', 'fill_1024x768_under_40ms', 'fill_is_one_undo_step'],
    spec: [['F-041', 'Left click replaces the 4-connected region of exactly matching color under the cursor with the foreground color.'], ['F-042', 'Right click fills with the background color.'], ['F-043', 'Only the four edge neighbours count. A region does not leak through a diagonal-only gap.'], ['F-044', 'Filling a region with its own color changes nothing and adds no undo step.'], ['F-045', 'Matching is exact on 24-bit RGB. There is no tolerance.'], ['F-046', 'One fill is one undo step.']],
    ns: 4
  },
  'tool.airbrush': {
    tests: ['airbrush_disc_9px', 'airbrush_disc_16px', 'airbrush_disc_24px', 'airbrush_still_cursor_keeps_spraying', 'airbrush_right_button_background', 'airbrush_ignores_fill_style'],
    spec: [['A-017', 'Each spray tick places pixels uniformly inside a disc of the chosen size: 9, 16 or 24 pixels across.'], ['A-018', 'Sprayed pixels never land outside the disc.'], ['A-019', 'Spray density follows a fixed timer, not mouse events.'], ['A-020', 'The airbrush ignores the fill-style option.']],
    ns: 3
  },
  'menu.image.flip': {
    tests: ['flip_horizontal_whole_image', 'flip_vertical_whole_image', 'flip_acts_on_selection_only', 'rotate_90_swaps_dimensions', 'flip_is_one_undo_step', 'ctrl_r_opens_dialog'],
    spec: [['I-008', 'With a selection, flip and rotate act on the selection only. Without one, on the whole image.'], ['I-009', 'Rotating by 90 or 270 degrees swaps the canvas width and height.'], ['I-010', 'Ctrl+R opens the dialog with "Flip horizontal" selected.']]
  }
};

const FEATURES = RAW.trim().split('\n').map((line, idx) => {
  const [id, title, l, p] = line.split('|');
  return { id, title, layer: l, prio: p, idx, state: 'pending', progress: 0, agent: null, commits: [], round: null, vis: [], sp: 0, ns: 0 };
});
const BY_ID = Object.fromEntries(FEATURES.map(f => [f.id, f]));

function srcPath(f) {
  const parts = f.id.split('.');
  const leaf = parts[parts.length - 1].replace(/-/g, '_');
  switch (parts[0]) {
    case 'tool': return `src/tools/${parts[1].replace(/-/g, '_')}.rs`;
    case 'menu': return `src/menu/${parts[1]}.rs`;
    case 'shortcut': return 'src/input/accelerators.rs';
    case 'format': return `src/io/${parts[1]}.rs`;
    case 'canvas': return `src/canvas/${parts[1]}.rs`;
    case 'dialog': return `src/ui/dialogs/${leaf}.rs`;
    default: return 'src/palette.rs';
  }
}
const baseName = f => f.id.split('.').slice(1).join('_').replace(/-/g, '_');

FEATURES.forEach(f => {
  const o = OVERRIDE[f.id];
  let names;
  if (o) names = o.tests.slice();
  else {
    const pool = VERBS[f.layer].slice(); names = [];
    const n = ri(4, Math.min(7, pool.length));
    for (let i = 0; i < n; i++) names.push(baseName(f) + '_' + pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  }
  f.vis = names.map(name => ({ name, pass: false, ms: 0 }));
  f.ns = o && o.ns ? o.ns : Math.max(1, Math.round(names.length * 0.43));
  f.spec = o ? o.spec : SPEC_TPL[f.layer](f.title.replace(/^.*› /, '')).map((t, i) => [`${f.layer.toUpperCase()}-${String(100 + f.idx * 3 + i).padStart(3, '0')}`, t]);
});

const BUILDERS = ['builder-1', 'builder-2', 'builder-3', 'builder-4'];
const AGENTS = [
  ...BUILDERS.map((id, i) => ({ id, kind: 'builder', label: id, short: 'B' + (i + 1), model: 'Sonnet', where: `wt/b${i + 1}`, feat: null, prog: 0, tok: ri(2100, 3900) * 1000, log: [] })),
  { id: 'verifier', kind: 'verifier', label: 'verifier', short: 'V', model: 'Sonnet', where: 'read-only', feat: null, prog: 0, tok: 1480000, log: [], text: '' },
  { id: 'reviewer', kind: 'reviewer', label: 'Codex', short: 'Cx', model: 'Codex', where: 'cross-family', feat: null, prog: 0, tok: 1920000, log: [], text: '' }
];
const AG = Object.fromEntries(AGENTS.map(a => [a.id, a]));

const COMMIT_MSG = {
  p: ['rasterise with integer Bresenham steps', 'match the original edge pixels at canvas bounds', 'draw the XOR preview while dragging', 'keep stroke width on zoomed canvas'],
  b: ['wire menu item and accelerator', 'grey out item when nothing is selected', 'record one undo step per action', 'keep tool state across switches'],
  f: ['write rows bottom-up with 4-byte padding', 'read palette in file order', 'reject truncated headers with the original message', 'round-trip resolution fields'],
  u: ['lay out controls on the original 8px dialog grid', 'add access keys from evidence captures', 'validate numeric ranges', 'make Enter hit the default button']
};
const visRate = f => f.vis.length ? f.vis.filter(t => t.pass).length / f.vis.length : 0;
function setResult(f, kind, opts = {}) {
  const nv = f.vis.length;
  if (kind === 'pass') {
    f.vis.forEach(t => { t.pass = true; t.ms = ri(2, 60); });
    f.sp = opts.overfit ? f.ns - 1 : f.ns;
  } else {
    const k = Math.max(1, Math.floor(nv * (0.35 + rng() * 0.35)));
    f.vis.forEach((t, i) => { t.pass = i < k; t.ms = ri(2, 80); });
    for (let i = f.vis.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [f.vis[i].pass, f.vis[j].pass] = [f.vis[j].pass, f.vis[i].pass]; }
    f.sp = Math.min(f.ns, Math.max(0, Math.round(f.ns * (0.2 + rng() * 0.4))));
  }
  f.state = kind;
}
function addCommits(f, agent, round, n) {
  for (let i = 0; i < n; i++) f.commits.unshift({ hash: hex(7), msg: (i === 0 ? 'feat' : pick(['fix', 'fix', 'refactor'])) + `(${f.id}): ` + pick(COMMIT_MSG[f.layer]), agent, round, ago: null });
}

const PREFIX_BUILDING = { 'builder-1': 'tool.text', 'builder-2': 'menu.image.stretch', 'builder-3': 'format.png', 'builder-4': 'dialog.edit-colors' };
const PREBUILT = new Set(Object.values(PREFIX_BUILDING));
FEATURES.forEach(f => {
  if (PREBUILT.has(f.id)) return;
  const r = rng();
  const [pp, pf] = f.prio === 'm' ? [0.86, 0.07] : f.prio === 's' ? [0.6, 0.08] : [0.3, 0.06];
  const agent = pick(BUILDERS);
  if (r < pp) { setResult(f, 'pass', { overfit: rng() < 0.05 }); f.agent = agent; f.round = rng() < 0.7 ? 1 : 2; addCommits(f, agent, f.round, ri(1, 3)); }
  else if (r < pp + pf) { setResult(f, 'fail'); f.agent = agent; f.round = rng() < 0.5 ? 1 : 2; addCommits(f, agent, f.round, ri(1, 2)); }
});
['tool.fill', 'tool.airbrush'].forEach((id, i) => { const f = BY_ID[id]; f.commits = []; setResult(f, 'pass', { overfit: true }); f.agent = i ? 'builder-4' : 'builder-2'; f.round = 2; addCommits(f, f.agent, 2, 3); });
{ const f = BY_ID['menu.image.flip']; f.commits = []; setResult(f, 'pass'); f.agent = 'builder-1'; f.round = 1; addCommits(f, 'builder-1', 1, 2); }
FEATURES.forEach(f => f.commits.forEach((c, i) => { c.ago = (c.round === 2 ? ri(2, 38) : ri(42, 70)) + i * 3; }));

const startProg = { 'builder-1': 0.58, 'builder-2': 0.31, 'builder-3': 0.84, 'builder-4': 0.12 };
Object.entries(PREFIX_BUILDING).forEach(([aid, fid]) => {
  const a = AG[aid], f = BY_ID[fid];
  a.feat = fid; a.prog = startProg[aid];
  f.state = 'building'; f.agent = aid; f.round = 2; f.progress = a.prog;
});

const T0 = Date.now();
const S = { tick: 0, paused: false, elapsed: 2 * 3600 + 14 * 60 + 8, tokens: 21384120, ah: 11.62, wall: [], reviewQueue: [], specState: 'pending', history: [], marks: [], roundStart: 0, nextWall: 3 };
const RATE = 4.1 / 1e6;
const nowMs = () => T0 + S.tick * 800;

function parity() {
  let p = 0, t = 0;
  FEATURES.forEach(f => { t += f.vis.length + f.ns; if (f.state !== 'pending') p += f.vis.filter(x => x.pass).length + (f.state === 'building' ? (f.prevSp || 0) : f.sp); });
  return { pct: p / t * 100, pass: p, total: t };
}
(function seedHistory() {
  const now = parity().pct, pts = [];
  const shape = m => m < 52 ? 0 : m < 68 ? (m - 52) / 16 * 0.2 : m < 118 ? 0.2 + (1 - Math.pow(1 - (m - 68) / 50, 1.6)) * 0.62 : 0.82 + (m - 118) / 16 * 0.18;
  let prev = 0;
  for (let i = 0; i <= 134; i++) { let v = shape(i) * now; if (i > 52) v = Math.max(prev, v - rng() * 1.6); prev = v; pts.push(v); }
  pts[pts.length - 1] = now;
  S.history = pts; S.marks = [{ i: 52, label: 'Pilot' }, { i: 68, label: 'Round 1' }, { i: 118, label: 'Round 2' }];
  S.roundStart = pts[118];
})();

function laneDoing(a) {
  if (a.kind === 'builder') {
    if (!a.feat) return '';
    const f = BY_ID[a.feat], p = a.prog, nv = f.vis.length;
    if (p < 0.15) return `Reading spec ${f.spec[0][0]}–${f.spec[f.spec.length - 1][0]}`;
    if (p < 0.38) return `Editing ${srcPath(f)}`;
    if (p < 0.55) return 'cargo build';
    if (p < 0.78) return `cargo test --test visible · ${Math.max(1, Math.round(nv * p))}/${nv}`;
    if (p < 0.92) { const n = Math.max(1, Math.round(nv * (1 - p) * 2)); return `Fixing ${n} failing test${n > 1 ? 's' : ''}`; }
    return 'Committing to ' + a.where;
  }
  return a.text;
}
function laneLog(a, text, id) { a.log.unshift({ at: new Date(nowMs()).toISOString(), text, id }); a.log.length = Math.min(a.log.length, 8); }

const ROOM = ['evidence/menu-image.png', 'evidence/tool-airbrush.gif', 'evidence/dialog-attributes.png', 'inventory/screens.json', 'evidence/fill-diagonal.png', 'notes/observer-07.md', 'evidence/bmp-corpus/'];
const TESTF = ['fill.rs', 'airbrush.rs', 'flip.rs', 'bmp24.rs', 'undo.rs', 'text.rs', 'stretch.rs'];
function wallEntry() {
  const b = pick(BUILDERS), r = rng();
  if (r < 0.3) return { who: b, tool: 'Read', target: `../brushling.remake-room/${pick(ROOM)}`, reason: 'builder may not touch the room' };
  if (r < 0.45) return { who: 'observer', tool: 'WebFetch', target: pick(['jspaint.app', 'jspaint.app/#load:', 'github.com/1j01/jspaint', 'web.archive.org/…/paint98']), reason: "on this run's blocklist" };
  if (r < 0.65) return { who: b, tool: 'Edit', target: `tests/visible/${pick(TESTF)}`, reason: 'tests are read-only for builders' };
  if (r < 0.77) return { who: b, tool: 'Read', target: 'tests/sealed/…', reason: 'sealed tests are never readable' };
  if (r < 0.86) return { who: b, tool: 'Bash', target: pick(['cargo test --test sealed', 'cat ../brushling.remake-room/inventory/menus.json', 'git log --all -- ../']), reason: 'outside the builder sandbox' };
  if (r < 0.94) return { who: b, tool: 'WebSearch', target: pick(['"paint 98 airbrush algorithm"', '"win98 paint flood fill source"', '"paint bmp writer resolution fields"']), reason: 'web search is off for builders' };
  return { who: 'verifier', tool: 'Write', target: pick(['src/tools/fill.rs', 'src/io/bmp.rs']), reason: 'verifier is read-only on source' };
}
function pushWall(w, atMs) { S.wall.unshift(Object.assign(w, { n: S.wall.length + 1, at: new Date(atMs).toISOString() })); if (S.wall.length > 300) S.wall.length = 300; }
(function seedWall() {
  let t = T0 - (2 * 3600 + 14 * 60 - 52 * 60) * 1000;
  for (let i = 0; i < 46; i++) { t += ri(70, 128) * 1000; pushWall(wallEntry(), t); }
  [
    { who: 'builder-1', tool: 'Edit', target: 'tests/visible/fill.rs', reason: 'tests are read-only for builders' },
    { who: 'observer', tool: 'WebFetch', target: 'jspaint.app', reason: "on this run's blocklist" },
    { who: 'builder-3', tool: 'Read', target: '../brushling.remake-room/evidence/menu-image.png', reason: 'builder may not touch the room' }
  ].forEach((w, i) => pushWall(w, T0 - (3 - i) * ri(40, 90) * 1000));
})();

function nextFor() {
  const fails = FEATURES.filter(f => f.state === 'fail');
  if (fails.length && rng() < 0.3) return pick(fails);
  const pend = FEATURES.filter(f => f.state === 'pending').sort((a, b) => 'msc'.indexOf(a.prio) - 'msc'.indexOf(b.prio) || a.idx - b.idx);
  return pend.length ? pend[Math.min(pend.length - 1, ri(0, 3))] : null;
}
function finish(a) {
  const f = BY_ID[a.feat];
  const pp = f.prio === 'm' ? 0.82 : f.prio === 's' ? 0.74 : 0.62;
  setResult(f, rng() < pp ? 'pass' : 'fail', { overfit: rng() < 0.08 });
  f.progress = 0; f.prevSp = 0; f.round = 2;
  addCommits(f, a.id, 2, ri(1, 2)); f.commits.forEach(c => { if (c.ago === null) c.ago = 0; });
  laneLog(a, `${f.state === 'pass' ? 'Passed' : 'Failed'} ${f.id} · visible ${f.vis.filter(t => t.pass).length}/${f.vis.length}`, f.id);
  const v = AG.verifier; v.feat = f.id; v.prog = 0.15; v.text = `Sealed suite on ${a.where} · ${f.ns} tests`;
  laneLog(v, `Sealed ${f.id} · ${f.sp}/${f.ns}`, f.id);
  S.reviewQueue.push(f.id);
  const n = nextFor();
  if (n) { a.feat = n.id; a.prog = 0; n.prevSp = n.state === 'fail' ? n.sp : 0; n.state = 'building'; n.agent = a.id; n.progress = 0; n.round = 2; }
  else a.feat = null;
}

function tick() {
  if (S.paused) return;
  S.tick++;
  S.elapsed += 0.8; S.ah += 6 * 0.8 / 3600;
  const add = ri(1400, 5200); S.tokens += add;
  AGENTS.forEach(a => { if (a.feat || a.kind !== 'builder') a.tok += Math.round(add / 6); });
  BUILDERS.forEach(id => {
    const a = AG[id]; if (!a.feat) return;
    a.prog = Math.min(1, a.prog + 0.025 + rng() * 0.06);
    const f = BY_ID[a.feat]; f.progress = a.prog;
    if (a.prog >= 1) finish(a);
    else if (a.prog > 0.55) { const want = Math.floor(f.vis.length * (a.prog - 0.4) / 0.6); f.vis.forEach((t, i) => { if (i < want && !t.pass) { t.pass = true; t.ms = ri(2, 60); } }); }
  });
  const v = AG.verifier;
  if (v.feat) { v.prog = Math.min(1, v.prog + 0.2); if (v.prog >= 1) v.text = `Done · ${BY_ID[v.feat].sp}/${BY_ID[v.feat].ns} sealed passing`; }
  const r = AG.reviewer;
  if (S.tick % 5 === 0) {
    if (S.reviewQueue.length) {
      const id = S.reviewQueue.shift(), f = BY_ID[id], c = f.commits[0];
      r.feat = id; r.prog = 0.1;
      const verdict = (visRate(f) - f.sp / f.ns) * 100 > 15 ? 'sent back: fits the tests, not the spec' : f.state === 'fail' ? 'changes requested' : pick(['approved', 'approved', 'approved with one nit']);
      r.text = `Reviewing ${c.hash} · ${c.msg.replace(/^\w+\([^)]*\): /, '')}`;
      laneLog(r, `${c.hash} ${verdict}`);
    } else if (r.feat) r.prog = Math.min(1, r.prog + 0.3);
  } else if (r.feat) r.prog = Math.min(1, r.prog + 0.12);
  if (S.tick >= S.nextWall) { S.nextWall = S.tick + ri(4, 8); pushWall(wallEntry(), nowMs()); }
  if (S.tick % 4 === 0) S.history.push(parity().pct);
}

const STATUS = { pass: 'passing', fail: 'failing', building: 'building', pending: 'pending' };
const pct1 = (p, t) => t ? Math.floor(p / t * 1000) / 10 : null;
const SPEC_GROUPS = [
  { id: 'tool.fill', title: 'Fill with color', priority: 'must', layer: 'pixel', lines: [
    { k: 'F-041', text: 'Left click replaces the 4-connected region of exactly matching color under the cursor with the foreground color.' },
    { k: 'F-042', text: 'Right click fills with the background color.' },
    { k: 'F-043', text: 'Neighbouring pixels count as part of the region.', mark: 'strike' },
    { k: 'F-043', text: 'Only the four edge neighbours count. A region does not leak through a diagonal-only gap.', mark: 'amend', tag: 'rev 2 · builder-2' },
    { k: 'F-044', text: 'Filling a region with its own color changes nothing and adds no undo step.' }] },
  { id: 'tool.airbrush', title: 'Airbrush', priority: 'should', layer: 'pixel', lines: [
    { k: 'A-017', text: 'Each spray tick places pixels uniformly inside a disc of the chosen size: 9, 16 or 24 pixels across.' },
    { k: 'A-019', text: 'Holding the button still keeps spraying.', mark: 'strike' },
    { k: 'A-019', text: 'Spray density follows a fixed timer, not mouse events. A still cursor keeps filling the disc at the same rate.', mark: 'amend', tag: 'rev 2 · builder-4' },
    { k: 'A-020', text: 'The airbrush ignores the fill-style option.' }] },
  { id: 'menu.image.flip', title: 'Flip and rotate', priority: 'must', layer: 'behaviour', lines: [
    { k: 'I-008', text: 'With a selection, flip and rotate act on the selection only. Without one, on the whole image.' },
    { k: 'I-009', text: 'Rotating by 90 or 270 degrees swaps the canvas width and height; the selection keeps its top-left corner.', mark: 'amend', tag: 'rev 2 · builder-1' },
    { k: 'I-010', text: 'Ctrl+R opens the dialog with "Flip horizontal" selected.' }] },
  { id: 'format.bmp.24', title: '24-bit bitmap', priority: 'must', layer: 'format', lines: [
    { k: 'B-002', text: 'Rows are stored bottom-up, padded to a multiple of four bytes.' },
    { k: 'B-003', text: 'Saving then reopening a file reproduces every pixel exactly.' },
    { k: 'B-004', text: 'The resolution fields are written as 0 so the file opens at 1:1.' }] }
];

function snapshot() {
  const now = nowMs();
  const p = parity();
  const features = FEATURES.map(f => {
    const built = f.state === 'pass' || f.state === 'fail';
    const vp = f.vis.filter(t => t.pass).length;
    const visible = built || (f.state === 'building' && vp) ? { passed: vp, total: f.vis.length } : null;
    const sealed = built ? { passed: f.sp, total: f.ns } : null;
    const gap = visible && sealed ? Math.round((pct1(visible.passed, visible.total) - pct1(sealed.passed, sealed.total)) * 10) / 10 : null;
    return {
      id: f.id, title: f.title, layer: LAYER[f.layer], priority: PRIO[f.prio], status: STATUS[f.state],
      progress: f.state === 'building' ? f.progress : null, agent: f.agent, visible, sealed, sealedCount: f.ns,
      overfit: built && gap !== null && gap > 15, gap: built ? gap : null,
      spec: f.spec, source: srcPath(f),
      review: built ? ((gap || 0) > 15 ? 'sent back' : f.state === 'pass' ? 'approved' : 'changes requested') : null,
      tests: f.vis.map(t => ({ name: t.name, status: !built && !(f.state === 'building' && t.pass) ? 'not-run' : t.pass ? 'pass' : 'fail', message: '', ms: t.ms })),
      commits: f.commits.map(c => ({ hash: c.hash, msg: c.msg, at: new Date(now - (c.ago || 0) * 60000).toISOString(), agent: c.agent }))
    };
  });
  const layers = ['behaviour', 'pixel', 'format', 'ui'].map(key => {
    let vp = 0, vt = 0, sp = 0, st = 0;
    const fs = features.filter(f => f.layer === key);
    FEATURES.filter(f => LAYER[f.layer] === key).forEach(f => { vt += f.vis.length; st += f.ns; vp += f.vis.filter(x => x.pass).length; if (f.state === 'pass' || f.state === 'fail') sp += f.sp; });
    return { key, features: fs.length, visible: { passed: vp, total: vt }, sealed: { passed: sp, total: st }, overfit: fs.filter(f => f.overfit).length };
  });
  const cost = S.tokens * RATE;
  return {
    version: 1, mode: 'demo', generatedAt: new Date(now).toISOString(),
    app: { name: 'Brushling', stack: 'rust-egui', builders: 4, cheap: false, original: 'Paint (Win98)', room: 'brushling.remake-room' },
    status: S.paused ? 'paused' : 'running', paused: S.paused,
    phases: [['Inventory', '12m', 'done'], ['Spec', '19m', 'done'], ['Tests', '21m', 'done'], ['Pilot', '16m', 'done'], ['Build', '', 'now'], ['Verify', '', 'future'], ['Review', '', 'future']].map(([name, meta, state], n) => ({ n: n + 1, name, meta, state })),
    phase: 'Build', phaseDetail: 'round 2 of 3', phaseShort: 'Round 2', phaseClock: 'Round 2 of 3', runLabel: 'Run 4',
    run: { startedAt: new Date(Date.now() - S.elapsed * 1000).toISOString(), elapsedSec: S.elapsed, frozen: S.paused },
    usage: { tokens: S.tokens, costUsd: cost, ratePerMin: 0.66, agentHours: S.ah, budgetUsd: 150, agents: Object.fromEntries(AGENTS.map(a => [a.id, a.tok])) },
    parity: { overall: p.pct, passed: p.pass, total: p.total, delta: p.pct - S.roundStart, deltaLabel: 'this round', at: new Date(now).toISOString() },
    history: S.history.map(overall => ({ overall })), marks: S.marks,
    layers, features,
    agents: AGENTS.map(a => ({ id: a.id, kind: a.kind, label: a.label, short: a.short, model: a.model, where: a.where, feature: a.feat, detail: laneDoing(a), progress: a.prog, tokens: a.tok, log: a.log.slice(0, 4) })),
    reviewNote: 'Codex reviews every commit Claude writes',
    wall: { count: S.wall.length, entries: S.wall.slice(0, 40) },
    spec: {
      state: S.specState, version: 2, publishedVersion: 1, hash: 'demo', features: FEATURES.length,
      split: { must: FEATURES.filter(f => f.prio === 'm').length, should: FEATURES.filter(f => f.prio === 's').length, could: FEATURES.filter(f => f.prio === 'c').length },
      changed: 3, groups: SPEC_GROUPS, more: 0,
      blurb: 'Round 2 builders hit three ambiguities. The spec agent rewrote three lines against the evidence. Round 3 starts from whatever you approve here.',
      holdNote: 'Builders hold at the end of round 2 until you decide.'
    },
    warnings: []
  };
}

window.RCDemo = {
  start(onState) {
    S.paused = new URLSearchParams(location.search).get('paused') === '1';
    AGENTS.filter(a => a.kind === 'builder').forEach(a => laneLog(a, `Picked up ${a.feat}`, a.feat));
    { const v = AG.verifier, last = FEATURES.filter(f => f.state === 'pass' && f.round === 2).slice(-1)[0]; v.feat = last.id; v.prog = 1; v.text = `Done · ${last.sp}/${last.ns} sealed passing`; laneLog(v, `Sealed ${last.id} · ${last.sp}/${last.ns}`, last.id); }
    { const r = AG.reviewer, f = BY_ID['tool.fill']; r.feat = f.id; r.prog = 0.7; r.text = `Reviewing ${f.commits[0].hash} · sealed gap on diagonal leaks`; laneLog(r, `${f.commits[0].hash} sent back: fits the tests, not the spec`); }
    onState(snapshot());
    setInterval(() => { tick(); onState(snapshot()); }, 800);
  },
  control(action, body) {
    if (action === 'pause') S.paused = true;
    else if (action === 'resume') S.paused = false;
    else if (action === 'approve') S.specState = 'approved';
    else if (action === 'request') { S.specState = 'changes'; }
    const s = snapshot();
    if (action === 'request') s.spec.note = body && body.note;
    return Promise.resolve(s);
  }
};
})();
