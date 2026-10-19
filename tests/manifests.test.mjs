// E3/E4: the skill and manifests must stay loadable outside Claude Code.
// Mirrors the checks of skills-ref validate (Agent Skills spec) and keeps the
// Claude, Codex and marketplace manifests in step.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const json = (p) => JSON.parse(readFileSync(path.join(root, p), "utf8"));
const SPEC_FIELDS = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools"]);

function frontmatter(file) {
  const m = readFileSync(file, "utf8").replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, `${file} has no frontmatter`);
  const fields = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2];
  }
  return fields;
}

for (const dir of readdirSync(path.join(root, "skills"))) {
  test(`skills/${dir}/SKILL.md uses only portable frontmatter`, () => {
    const fm = frontmatter(path.join(root, "skills", dir, "SKILL.md"));
    const extra = Object.keys(fm).filter((k) => !SPEC_FIELDS.has(k));
    assert.deepEqual(extra, [], "fields outside the Agent Skills spec break skills-ref validate");
    assert.equal(fm.name, dir, "name must equal the directory name");
    assert.match(fm.name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.ok(fm.description && fm.description.length <= 1024, "description is required, at most 1024 chars");
    if (fm.compatibility) assert.ok(fm.compatibility.length <= 500, "compatibility is at most 500 chars");
  });
}

test("Claude and Codex manifests agree on identity", () => {
  const claude = json(".claude-plugin/plugin.json");
  const codex = json(".codex-plugin/plugin.json");
  for (const key of ["name", "version", "license", "repository"]) assert.equal(codex[key], claude[key], key);
  assert.equal(codex.skills, "./skills/");
  assert.deepEqual(codex.hooks, {}, "Codex lists only hook-free plugins in its directory, and the wall's matchers are Claude tool names");
});

test("both marketplaces point at this repo's plugin", () => {
  const name = json(".claude-plugin/plugin.json").name;
  const claude = json(".claude-plugin/marketplace.json").plugins.find((p) => p.name === name);
  assert.equal(claude?.source, "./");
  const codex = json(".agents/plugins/marketplace.json").plugins.find((p) => p.name === name);
  assert.deepEqual(codex?.source, { source: "local", path: "./" });
  assert.equal(codex.policy?.installation, "AVAILABLE");
  assert.ok(codex.policy?.authentication && codex.category, "policy.authentication and category are required by Codex");
});

// REA is the observer's alone; the wall enforces it, the agent files must not offer it elsewhere.
test("only the observer is given REA's MCP tools", () => {
  for (const file of readdirSync(path.join(root, "agents"))) {
    const tools = (frontmatter(path.join(root, "agents", file)).tools || "").split(/,\s*/);
    if (file === "observer.md") {
      assert.ok(tools.includes("mcp__rea__*"), "observer lists mcp__rea__*");
      // Without ToolSearch a subagent gets every REA schema inline and its context overflows.
      assert.ok(tools.includes("ToolSearch"), "observer can defer REA's tools");
    }
    else assert.ok(!tools.some((t) => t.startsWith("mcp__")), `${file} lists no MCP tools`);
  }
});

test("the skill documents every init-run mode flag", () => {
  const skill = readFileSync(path.join(root, "skills", "remake", "SKILL.md"), "utf8");
  for (const flag of ["--with-rea", "--open", "--basis own|license|authorized", "open mode: not clean-room", "EULA"]) assert.ok(skill.includes(flag), flag);
  assert.match(skill, /^1\. \*\*Never read the original's code, unless the run's mode allows it\.\*\*/m);
});

test("the README states each mode and its label as the scripts print it", async () => {
  const readme = readFileSync(path.join(root, "README.md"), "utf8");
  const { modeLabel } = await import("../scripts/lib/run.mjs");
  for (const heading of ["## Modes", "## Works with REA", "**How is this different from REA?**"]) assert.ok(readme.includes(heading), heading);
  for (const m of [{}, { rea: true }, { mode: "open" }]) assert.ok(readme.includes(modeLabel(m)), modeLabel(m));
  assert.ok(readme.includes("--basis own|license|authorized"));
});
