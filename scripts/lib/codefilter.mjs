// The code filter for runs started --with-rea. There the observer reads the
// original's code through REA and the decompilers, and writes behaviour only;
// this is the check that it did, on everything that crosses to the builders.
// publish.mjs refuses the spec or the visible tests when a line still carries
// code: addresses, disassembly, decompiled C, or a name REA pulled out of the
// binary. Strict on purpose: a false stop costs a rephrase, a leak costs the run.
//
// Not used in clean runs (nobody saw code) or open runs (everyone may).

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { RunError, listFiles, toSlash } from "./run.mjs";

const MNEMONICS = String.raw`mov|movzx|movsx|movsxd|movabs|lea|push|pop|call|jmp|j[a-z]{1,3}|cmp|test|xor|and|or|not|add|sub|imul|mul|idiv|div|shl|shr|sar|inc|dec|ret|nop|cmov[a-z]{1,3}|set[a-z]{1,3}|ldr|ldrb|str|strb|stp|ldp|bl|blr|cbz|cbnz`;
const REGISTERS = String.raw`[re]?[abcd]x|[re]?[sb]p|[re]?[sd]i|r(?:[89]|1[0-5])[dwb]?|xmm\d+|ymm\d+|[xw](?:[12]?\d|3[01])`;

/** Rules for every document that crosses: spec and visible tests alike. */
const CODE_RULES = [
  // 0x180124945. Six digits and up is address territory; write colours as #rrggbb.
  { id: "hex-address", re: /\b0x[0-9a-f]{6,}\b/i },
  // sub_401000, FUN_00401000, loc_..., DAT_..., LAB_...: decompiler names for code and data.
  { id: "decompiler-name", re: /\b(sub|loc|fun|func|dat|lab|off|unk|byte|word|dword|qword|ptr|nullsub|j_sub)_[0-9a-f]{4,}\b/i },
  // .text:00401000, 00401000: mov ...
  { id: "address-label", re: /(\.(text|data|rdata|bss|code):[0-9a-f]{4,}|(^|\s)(?=[0-9a-f]*\d)[0-9a-f]{6,}h?:\s)/i },
  // MOV EAX, dword ptr [R13 + 0x18] / ldr x0, [x1, #8]
  { id: "assembly", re: new RegExp(String.raw`\b(?:${MNEMONICS})\s+(?:${REGISTERS}|(?:byte|word|dword|qword)\s+ptr|\[)[^,\n]*,`, "i") },
  { id: "assembly", re: /\b(byte|word|dword|qword|xmmword)\s+ptr\s*\[/i },
];

/** Rules for prose only. Visible tests are code by nature; the spec never is. */
const PROSE_RULES = [
  // if (operation == multiply || operation == divide) {
  { id: "c-like", re: /\b(if|while|for|switch|else\s+if)\s*\([^)]*(==|!=|<=|>=|&&|\|\||[<>]|\w\s*\()/ },
  // Name against name, not a value check: "mode == multiply" is code, "result == 5" an acceptance line.
  { id: "c-like", re: /[\w)\]]\s*(&&|\|\|)\s*[\w!(]|\b[A-Za-z_]\w*\s*(==|!=)\s*[A-Za-z_(]/ },
  { id: "c-like", re: /\)\s*\{\s*$|^\s*\}\s*else\b/ },
  { id: "c-like", re: /^\s*(return\b[^.]*|[\w.[\]>*-]+\s*([-+*/%|&^]?=)\s*[^=;]+);\s*$/ },
  { id: "c-like", re: /\b(int|void|char|bool|float|double|uint\d+_t|int\d+_t|size_t|DWORD|HWND|LPCSTR)\s+\**\w+(\(|\s*[;=])/ },
  { id: "c-like", re: /\w(->|::)\w+\s*\(/ },
];

// A REA name crosses only when it reads as code. A plain word is the
// vocabulary the spec needs ("multiply", "Percent"); an identifier with an
// underscore, a digit, a scope or a second hump is how the binary spelled it.
const looksLikeCode = (name) => /[_$:]|\d|\.\w+\(|[a-z][A-Z]|[A-Z]{2}[a-z]/.test(name) && name.length >= 4;

/** Every string under value, the way REA's JSON nests its lists. */
function names(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) names(v, out);
  else if (value && typeof value === "object") for (const k of ["name", "symbol", "demangled", "value", "text"]) if (value[k] !== undefined) names(value[k], out);
  return out;
}

/**
 * The names REA found that must not cross: symbols, functions and strings from
 * <room>/evidence/rea/*.json, less plain words and anything the inventory
 * already shows the user (titles, labels, observed text). Returns them sorted
 * longest first, so the longest match is reported.
 */
export function reaNames(room, inventory = null) {
  const dir = path.join(room, "evidence", "rea");
  if (!existsSync(dir)) return [];
  const seen = new Set();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    let data;
    try {
      data = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
    } catch (err) {
      throw new RunError(`evidence/rea/${file} is not valid JSON (${err.message}); the code filter needs it to know what to stop`);
    }
    for (const key of ["symbols", "functions", "strings"]) for (const n of names(data?.[key])) seen.add(n.trim());
  }
  const shown = JSON.stringify(inventory?.items ?? []).toLowerCase();
  return [...seen]
    .filter((n) => n.length >= 4 && n.length <= 200 && looksLikeCode(n) && !shown.includes(n.toLowerCase()))
    .sort((a, b) => b.length - a.length);
}

/** The text a line carries: the line itself, or its string literals in a JSON file. */
function lineText(line, json) {
  if (!json) return [line];
  const out = [];
  for (const m of line.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
    try { out.push(JSON.parse(`"${m[1]}"`)); } catch { out.push(m[1]); }
  }
  return out;
}

/**
 * Scans documents headed for the app tree. docs: [[label, text]]. prose: apply
 * the C-like rules too (the spec). Returns ["label:line: rule"] per hit.
 */
export function scanDocs(docs, { prose = false, reaNames: banned = [] } = {}) {
  const rules = prose ? [...CODE_RULES, ...PROSE_RULES] : CODE_RULES;
  const nameRes = banned.map((n) => ({ n, re: new RegExp(`(^|[^\\w$])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\w$])`) }));
  const hits = [];
  for (const [label, text] of docs) {
    const json = label.endsWith(".json");
    String(text).split(/\r?\n/).forEach((line, i) => {
      for (const t of lineText(line, json)) {
        const rule = rules.find((r) => r.re.test(t));
        const name = rule ? null : nameRes.find((r) => r.re.test(t));
        if (rule || name) { hits.push(`${label}:${i + 1}: ${rule ? rule.id : `REA name "${name.n}"`}`); break; }
      }
    });
  }
  return hits;
}

/** Every file under dir as [label, text], labelled under prefix. */
export function readDocs(dir, prefix) {
  return listFiles(dir).map((f) => [`${prefix}/${toSlash(path.relative(dir, f))}`, readFileSync(f, "utf8")]);
}
