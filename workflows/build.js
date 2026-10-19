export const meta = {
  name: 'build',
  description: 'Remakecraft phases 5-7: parallel builders in worktrees, harness verification with sealed tests, cross-model review',
  whenToUse: 'After the spec is approved and the tests are published for a Remakecraft run',
  phases: [
    { title: 'Plan', detail: 'pick unbuilt features' },
    { title: 'Build', detail: 'one builder per feature, own worktree' },
    { title: 'Merge', detail: 'merge passing branches' },
    { title: 'Verify', detail: 'visible + sealed tests, hashes, stub scan' },
    { title: 'Review', detail: 'Codex or Claude against the spec' },
  ],
}

// args: { builders?: 1-5, rounds?: number, only?: string[] (feature ids, e.g. the pilot), cheap?: boolean, pluginRoot?: string (absolute; the skill passes it) }
const BUILDERS = Math.max(1, Math.min(5, args?.cheap ? 1 : (args?.builders ?? 3)))
const ROUNDS = args?.rounds ?? 3
const BUILD_MODEL = args?.models?.builder ?? 'sonnet'
const REVIEW_MODEL = args?.cheap ? 'sonnet' : (args?.models?.reviewer ?? 'opus')

const PENDING = { type: 'object', properties: { features: { type: 'array', items: { type: 'string' } }, paused: { type: 'boolean' }, budget: { type: 'boolean' } }, required: ['features'] }
const GATE = { type: 'object', properties: { paused: { type: 'boolean' }, budget: { type: 'boolean' } }, required: ['paused'] }

// Pause from the run page lands between batches: builders already running finish their feature.
// The same status call refreshes .remake/progress/usage.json, so cost and the budget are checked per batch too.
// Agent Bash does not reliably have CLAUDE_PLUGIN_ROOT (anthropics/claude-code#93057), so the skill
// passes the resolved root and it is baked into the prompts. Unset, the literal variable is kept.
const ROOT = (typeof args?.pluginRoot === 'string' && args.pluginRoot.trim() ? args.pluginRoot.trim().replace(/\\/g, '/').replace(/\/+$/, '') : '${CLAUDE_PLUGIN_ROOT}')
const CONTROL = `node "${ROOT}/scripts/control.mjs"`
const STATUS = `${CONTROL} status`
const PAUSE_CHECK = ' Then run `' + STATUS + '` in the app tree. Set paused to true if it says the run is paused, and budget to true if it says the budget is reached.'
const WAIT = `In the app tree run \`${CONTROL} wait resume\` and let it finish. `
  + 'Exit 0 means resumed: return paused false. Exit 5 means still paused: return paused true. Exit 7 means the budget is spent: return paused false and budget true.'
const BUDGET_STOP = 'Stopping: the budget in remake.json is spent. Raise "budgetUsd" there and run /remakecraft:remake to resume.'

/** Waits out a pause; returns true when the budget ran out instead. */
async function holdWhilePaused(gate) {
  let { paused, budget } = gate
  while (paused && !budget) {
    log('Paused from the run page. Waiting for resume.')
    const g = await agent(WAIT, { model: BUILD_MODEL, phase: 'Build', label: 'paused', schema: GATE })
    paused = g.paused
    budget = g.budget === true
  }
  return budget === true
}
const BUILT = {
  type: 'object',
  properties: { feature: { type: 'string' }, branch: { type: 'string' }, visiblePass: { type: 'boolean' }, blocker: { type: 'string' } },
  required: ['feature', 'branch', 'visiblePass'],
}
const VERDICT = {
  type: 'object',
  properties: {
    score: { type: 'number' }, hashesOk: { type: 'boolean' }, stubHits: { type: 'number' },
    overfit: { type: 'array', items: { type: 'string' } },
  },
  required: ['score', 'hashesOk', 'stubHits'],
}
const REVIEW = {
  type: 'object',
  properties: { mustFix: { type: 'array', items: { type: 'object', properties: { feature: { type: 'string' }, finding: { type: 'string' } }, required: ['feature', 'finding'] } } },
  required: ['mustFix'],
}

let last = null
let outOfBudget = false
for (let round = 1; round <= ROUNDS && !outOfBudget; round++) {
  phase('Plan')
  const only = args?.only?.length ? ` Consider only these ids: ${args.only.join(', ')}.` : ''
  const pending = await agent(
    `Read .remake/progress/features.json and .remake/reports/review.md if present. Return the ids of features that are not yet passing, must-fix review items first, then must, should, could.${only}${PAUSE_CHECK}`,
    { agentType: 'remakecraft:verifier', schema: PENDING, label: `plan r${round}` },
  )
  if (!pending.features.length) { log('Nothing left to build.'); break }
  if (await holdWhilePaused(pending)) { log(BUDGET_STOP); outOfBudget = true; break }

  const batches = []
  for (let i = 0; i < pending.features.length; i += BUILDERS) batches.push(pending.features.slice(i, i + BUILDERS))

  for (const batch of batches) {
    const built = await parallel(batch.map(id => () => agent(
      `Build feature ${id}. Branch name: remake/${id}. Return the branch and whether its visible tests pass.`,
      { agentType: 'remakecraft:builder', isolation: 'worktree', model: BUILD_MODEL, phase: 'Build', label: id, schema: BUILT },
    )))
    const ready = built.filter(b => b && b.visiblePass)
    for (const b of built.filter(b => b && !b.visiblePass)) log(`${b.feature}: not passing${b.blocker ? ` (${b.blocker})` : ''}`)
    const gate = ready.length
      ? await agent(
        `Merge these branches into the app tree's main branch one at a time, running the visible suite after each and reverting any merge that breaks it: ${ready.map(b => b.branch).join(', ')}. Update .remake/progress/features.json.${PAUSE_CHECK}`,
        { agentType: 'remakecraft:merger', phase: 'Merge', label: `merge ${ready.length}`, schema: GATE },
      )
      : await agent(PAUSE_CHECK.trim().replace(/^Then run/, 'Run'), { model: BUILD_MODEL, phase: 'Build', label: 'pause check', schema: GATE })
    if (await holdWhilePaused(gate)) { log(BUDGET_STOP); outOfBudget = true; break }
  }
  if (outOfBudget) break

  last = await agent(`Verify the app tree now. The plugin root is ${ROOT}: run its scripts/parity.mjs by that absolute path.`, { agentType: 'remakecraft:verifier', phase: 'Verify', label: `verify r${round}`, schema: VERDICT })
  log(`Round ${round}: parity ${last.score}%`)
  if (!last.hashesOk || last.stubHits > 0) { log('Stopping: tests or spec were touched, or stubs were found. See .remake/reports/verify.md.'); break }

  const review = await agent('Review the work merged since the last review, then tag HEAD remake-reviewed.', {
    agentType: 'remakecraft:reviewer', model: REVIEW_MODEL, phase: 'Review', label: `review r${round}`, schema: REVIEW,
  })
  log(`Round ${round}: ${review.mustFix.length} must-fix findings`)
}

return outOfBudget ? { ...(last || {}), stopped: 'budget' } : last
