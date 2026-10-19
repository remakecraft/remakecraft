// SubagentStart: record every agent that starts inside a run. Together with
// wall.log and the prompts guard.mjs logs, this is the provenance trail the
// README points to. SubagentStart cannot block, so a failure here only loses
// the line and says so.

import { findRuns, appendLog, readStdinJson } from "./run.mjs";

try {
  const hook = readStdinJson();
  let runs = [];
  try { runs = findRuns(hook.cwd || process.cwd()); } catch { /* a broken manifest is the guard's to report */ }
  for (const run of runs) appendLog(run, "audit.log", { agent: hook.agent_type || null, id: hook.agent_id || null });
} catch (err) {
  process.stderr.write(`Remakecraft: could not write audit.log (${err.message}).\n`);
}
process.exit(0);
