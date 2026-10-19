// Stack presets: the commands parity.mjs runs, written into remake.json at
// init so the user can read and change them.
//
// Placeholders, filled by parity.mjs with forward-slash paths and never
// quoted for you (quote them in the command when they are paths):
//   {tests}   the suite's directory in the scratch checkout (tests/visible or tests/sealed)
//   {suite}   the suite's name: visible or sealed
//   {report}  the results file the command must write, JUnit XML or TAP
//   {plugin}  this plugin's root, for the runner shims in scripts/runners/
//
// Commands run through the platform shell (cmd.exe on Windows, sh elsewhere),
// so each preset is one program invocation with no chaining: `;`, `&&` and
// `||` do not mean the same thing in both.
//
// Rust runs through cargo-nextest because its JUnit output is stable; libtest's
// own --format json still needs -Z unstable-options, which means nightly or
// RUSTC_BOOTSTRAP. Sealed tests are copied to tests/sealed/ at run time, so a
// suite is a cargo test target: tests/visible/main.rs and tests/sealed/main.rs.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Node suites go through a shim too: Node 20 cannot expand a test glob and
// Node 22+ cannot take a test directory, so neither fits in one command.
const NODE_TEST = `node "{plugin}/scripts/runners/node-suite.mjs" "{tests}" "{report}"`;
// --ignore-scripts: install and postinstall scripts are builder-written code
// that would run after the sealed tests are copied in. Cargo has no
// equivalent for build.rs, so parity.mjs re-hashes tests/ after the build.
const NPM_INSTALL = "npm install --ignore-scripts --no-audit --no-fund";
const NEXTEST = `node "{plugin}/scripts/runners/nextest.mjs" {suite} "{report}"`;

// The scratch checkout has no node_modules, so Node stacks install first, and
// npm refuses to install without a package.json. Its `npm test` runs the
// visible suite through a copy of the parity shim, for the same reason
// NODE_TEST does.
const packageJson = (app) =>
  JSON.stringify({ name: app.toLowerCase(), private: true, type: "module", scripts: { test: "node scripts/run-suite.mjs tests/visible" } }, null, 2) + "\n";
const SUITE_SHIM = fileURLToPath(new URL("../runners/node-suite.mjs", import.meta.url));
const NODE_FILES = { "package.json": packageJson, "scripts/run-suite.mjs": () => readFileSync(SUITE_SHIM, "utf8") };

// The build and test tools a builder runs in its worktree, pre-approved so a run
// is not a prompt per test pass. Prefixes of Bash commands, as in Bash(<prefix>*).
const CARGO_TOOLS = ["cargo build", "cargo test", "cargo nextest", "cargo check", "cargo fmt", "cargo clippy", "cargo add ", "cargo run"];
const NODE_TOOLS = ["npm test", "npm install", "npm run ", "node scripts/run-suite.mjs", "node --test"];

export const STACKS = {
  "rust-egui": {
    commands: { build: "cargo build --all-targets", testVisible: NEXTEST, testSealed: NEXTEST },
    tools: CARGO_TOOLS,
    ignore: ["target/"],
    layout: "Rust crate. Each suite is a cargo test target: tests/visible/main.rs (mod per feature), tests/sealed/main.rs at run time. Needs cargo-nextest.",
  },
  web: {
    commands: { build: NPM_INSTALL, testVisible: NODE_TEST, testSealed: NODE_TEST },
    tools: NODE_TOOLS,
    ignore: ["node_modules/", "dist/"],
    files: NODE_FILES,
    layout: "Node test runner. Test files are tests/<suite>/**/*.test.mjs; sealed files sit at tests/sealed/ at run time, so relative imports match.",
  },
  tauri: {
    commands: { build: "cargo build --manifest-path src-tauri/Cargo.toml", testVisible: NODE_TEST, testSealed: NODE_TEST },
    tools: [...NODE_TOOLS, ...CARGO_TOOLS],
    ignore: ["node_modules/", "dist/", "src-tauri/target/"],
    files: NODE_FILES,
    layout: "Tauri app. Tests are Node test files in tests/<suite>/ that drive the headless CLI built from src-tauri.",
  },
};

export const STACK_NAMES = Object.keys(STACKS);
