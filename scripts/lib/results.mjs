// Reads the results files the test commands write. JUnit XML and TAP cover
// cargo-nextest, node --test and most other runners; the format is sniffed
// from the content, not the file name.
//
// Each result is { name, classname, status: "pass"|"fail"|"skip", message }.

const ENTITIES = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function decode(s) {
  return String(s ?? "").replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === "#") return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e] ?? m;
  });
}

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) out[m[1]] = decode(m[3] ?? m[4]);
  return out;
}

const firstLine = (s) => String(s || "").trim().split(/\r?\n/).find((l) => l.trim())?.trim() ?? "";
const clip = (s, n = 400) => (s.length > n ? s.slice(0, n) + "…" : s);

// cargo-nextest's message= holds only the panic location ("thread 't' panicked
// at tests/x.rs:3:24"); the assertion a builder needs is the panic payload in
// the element body. Returns "location: payload" on one line, or null.
function rustPanic(message, body) {
  if (!/panicked at .*:\d+:\d+$/.test(message)) return null;
  const m = body.replace(/\r\n/g, "\n").match(/panicked at [^\n]*:\d+:\d+:\n([\s\S]*?)(?:\nnote: |\n\s*$|$)/);
  const payload = m?.[1].split("\n").map((l) => l.trim()).filter(Boolean).join("; ");
  return payload ? `${message}: ${payload}` : null;
}

export function parseJUnit(xml) {
  const text = xml.replace(/<!--[\s\S]*?-->/g, "");
  const results = [];
  const re = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  for (const m of text.matchAll(re)) {
    const a = attrs(m[1]);
    const body = m[3] || "";
    const fail = body.match(/<(failure|error)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/);
    let status = "pass";
    let message = "";
    if (fail) {
      status = "fail";
      const fa = attrs(fail[2]);
      const text = decode((fail[4] || "").replace(/<!\[CDATA\[|\]\]>/g, ""));
      message = (fa.message && rustPanic(fa.message, text)) || fa.message || firstLine(text) || fail[1];
    } else if (/<skipped\b/.test(body)) status = "skip";
    results.push({ name: a.name ?? "", classname: a.classname ?? "", status, message: clip(message) });
  }
  return results;
}

export function parseTap(tap) {
  const lines = tap.split(/\r?\n/);
  const results = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)(not ok|ok)\b\s*(\d+)?\s*(?:-\s*)?([^#]*?)\s*(?:#\s*(\w+)\b.*)?$/i);
    if (!m) continue;
    const directive = (m[5] || "").toUpperCase();
    let status = m[2].toLowerCase() === "ok" ? "pass" : "fail";
    if (directive === "SKIP") status = "skip";
    if (directive === "TODO") status = status === "pass" ? "pass" : "fail";
    let message = "";
    // A YAML diagnostic block follows a failure; its error/message key is the assertion.
    if (status === "fail" && /^\s*---\s*$/.test(lines[i + 1] || "")) {
      const block = [];
      for (let j = i + 2; j < lines.length && !/^\s*\.\.\.\s*$/.test(lines[j]); j++) block.push(lines[j]);
      const k = block.findIndex((l) => /^\s*(error|message):/.test(l));
      if (k >= 0) {
        const inline = block[k].replace(/^\s*(error|message):\s*/, "").replace(/^\|-?\s*$|^>-?\s*$/, "").replace(/^['"]|['"]$/g, "");
        message = inline || (block[k + 1] || "").trim();
      }
    }
    results.push({ name: m[4].trim(), classname: "", status, message: clip(message), depth: m[1].length });
  }
  // node --test reports a describe() block as its own "ok" line after its
  // children; drop parents so a suite's pass does not count as a test.
  return results.filter((r, i) => !(i > 0 && results[i - 1].depth > r.depth)).map(({ depth, ...r }) => r);
}

/** Parses a results file of either format. Throws when it is neither. */
export function parseResults(text) {
  const t = text.replace(/^﻿/, "").trimStart();
  if (t.startsWith("<")) {
    if (!/<testsuites?\b|<testcase\b/.test(t)) throw new Error("XML results file has no <testsuite> or <testcase>");
    return { format: "junit", results: parseJUnit(t) };
  }
  if (/^(TAP version|1\.\.\d|(not )?ok\b)/m.test(t)) return { format: "tap", results: parseTap(t) };
  throw new Error("results file is neither JUnit XML nor TAP");
}

/** Normal form for matching runner names to manifest ids: Rust's mod::fn and dotted ids compare equal. */
export const normId = (s) => String(s).trim().toLowerCase().replace(/::|[\/\\\s]+/g, ".");

/**
 * Maps parsed results to manifest test ids. A result belongs to an id when its
 * name, or classname.name, equals the id or ends with "." + id, so module
 * prefixes a runner adds do not matter. Several results for one id (a
 * parametrised test) pass only if all of them pass. An id with no result failed.
 */
export function matchResults(ids, results) {
  const full = results.map((r) => ({ r, keys: [normId(r.name), normId(`${r.classname}.${r.name}`)] }));
  const used = new Set();
  const out = new Map();
  for (const id of ids) {
    const n = normId(id);
    const exact = full.filter(({ keys }) => keys.includes(n));
    const hits = exact.length ? exact : full.filter(({ keys }) => keys.some((k) => k.endsWith("." + n)));
    hits.forEach((h) => used.add(h.r));
    if (!hits.length) out.set(id, { status: "missing", message: "no result for this test" });
    else {
      const bad = hits.find((h) => h.r.status !== "pass");
      out.set(id, bad ? { status: bad.r.status, message: bad.r.message } : { status: "pass", message: "" });
    }
  }
  return { byId: out, unmatched: results.filter((r) => !used.has(r)).length };
}
