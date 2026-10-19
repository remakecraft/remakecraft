// The stub scan: placeholder code a builder might commit to make a feature
// look done, or code that reaches for the test harness. Hard hits fail the run. Empty function bodies are only warnings,
// because a no-op handler is often legitimate and a false stop costs a round.

import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { listFiles, toSlash } from "./run.mjs";

const SOURCE = new Set([
  ".rs", ".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx", ".vue", ".svelte",
  ".py", ".go", ".java", ".kt", ".cs", ".c", ".cc", ".cpp", ".h", ".hpp", ".swift",
]);
// Not the app's own source: the test suites (top-level tests/ only), dependencies,
// build output, run state and agent worktrees (anywhere).
const SKIP_DIRS = new Set(["node_modules", "target", "dist", "build", "out", ".git", ".remake", ".claude", ".next", "vendor", "__pycache__"]);
const MAX_BYTES = 1_000_000;

const NOT_IMPL = String.raw`not[ _-]?(yet[ _-]?)?implemented`;
export const STUB_RULES = [
  { id: "todo!", re: /\btodo!\s*\(/ },
  { id: "unimplemented!", re: /\bunimplemented!\s*\(/ },
  { id: "panic-not-implemented", re: new RegExp(String.raw`\bpanic!\s*\(\s*"[^"]*${NOT_IMPL}`, "i") },
  { id: "NotImplementedError", re: /\bNotImplementedError\b/ },
  { id: "throw-not-implemented", re: new RegExp(String.raw`\bthrow\s+(new\s+)?\w*Error\s*\(\s*["'\x60][^"'\x60]*${NOT_IMPL}`, "i") },
  { id: "NotImplementedException", re: /\bNotImplementedException\b/ },
  // The suites run in the app's own process (node --test) or its own crate, so
  // app code that knows about the harness can bend it: rewrite the sealed
  // files, patch the assertion module, or behave differently under test.
  { id: "sealed-tests-ref", re: /\btests[\\/]+sealed\b/i },
  { id: "test-runner-ref", re: /\bNODE_TEST\w*|\bnode:test\b|\bNEXTEST_\w+/ },
  { id: "assert-ref", re: /\bnode:assert\b|\brequire\s*\(\s*["'\x60]assert(\/strict)?["'\x60]\s*\)|\bfrom\s+["'\x60]assert(\/strict)?["'\x60]/ },
  { id: "module-loader-hook", re: /\bModule\.(_load|_resolveFilename|_extensions|prototype\.require)\b|\brequire\.cache\b|\bregisterHooks\s*\(/ },
];

// Multi-line, run on the whole file. Rust and JS/TS functions with nothing in
// the body; Python defs whose only statement is pass or `...`.
const EMPTY_RULES = [
  { ext: [".rs"], re: /\bfn\s+(\w+)\s*(<[^>{]*>)?\s*\([^)]*\)\s*(->\s*[^{;]+?)?\s*(where\s[^{]+)?\{\s*\}/g },
  { ext: [".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx"], re: /\bfunction\s*\*?\s*(\w+)\s*\([^)]*\)\s*(:\s*[^{]+)?\{\s*\}/g },
  { ext: [".py"], re: /^[ \t]*def\s+(\w+)\s*\([^)]*\)\s*(->\s*[^:]+)?:\s*(?:#[^\n]*)?\n(?:[ \t]*(?:#[^\n]*)?\n)*[ \t]+(?:pass|\.\.\.)[ \t]*(?:#[^\n]*)?$/gm },
];

const lineAt = (text, index) => text.slice(0, index).split("\n").length;

/** Scans a checkout. Returns { hits, empty } with file paths relative to root. */
export function scanStubs(root) {
  const hits = [];
  const empty = [];
  const top = path.join(root, "tests");
  const skip = (full, name) => SKIP_DIRS.has(name) || full === top;
  const files = listFiles(root, skip).filter((f) => SOURCE.has(path.extname(f).toLowerCase()) && statSync(f).size <= MAX_BYTES);
  for (const file of files) {
    const rel = toSlash(path.relative(root, file));
    const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    text.split("\n").forEach((line, i) => {
      for (const rule of STUB_RULES)
        if (rule.re.test(line)) hits.push({ file: rel, line: i + 1, rule: rule.id, text: line.trim().slice(0, 160) });
    });
    const ext = path.extname(file).toLowerCase();
    for (const rule of EMPTY_RULES.filter((r) => r.ext.includes(ext)))
      for (const m of text.matchAll(rule.re)) empty.push({ file: rel, line: lineAt(text, m.index + m[0].search(/\S/)), name: m[1] });
  }
  return { hits, empty, files: files.length };
}
