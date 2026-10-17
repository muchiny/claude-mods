import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { colorOf } from '../../hooks/colors'
import { WAIT_SIGN } from '../../hooks/view'
import { ENGINE_ROW, PLUGIN, SURFACES, lastState, world, writeFile } from './world'

// --- Fixtures réelles (sources : voir tests/engine/events.test.tsx) -------------------

// Sortie de ssh_disk_usage, fixture des sources de bridge-mcp (src/mcp/tool_handlers/ssh_disk_usage.rs:344).
const DF = 'Filesystem Size Used Avail Use% Mounted\n/dev/sda1 10G 5G 5G 50% /\n'
// refs/bridge-facts.md §3.1 (liste noire, rendu exact).
const DENIED = 'Command denied: Command matches blacklist pattern: \\bshutdown\\b'
// refs/bridge-facts.md §3.5.
const SSH_REFUSED = 'SSH connection failed to raspberry: Connection refused (os error 111)'
// refs/bridge-facts.md §5.2.
const CONFIRM_EXEC =
  'Confirm destructive operation: `ssh_exec`\n\n**Arguments:**\n```json\n{"command":"systemctl restart nginx","host":"raspberry"}\n```\n\n**Command:**\n```sh\nsystemctl restart nginx\n```\n\nProceed?'
// Plan au format des plans de l'utilisateur (spec §5.2).
const PLAN_PATH = '/home/user/claude-mods-0.2/docs/superpowers/plans/2026-10-15-exemple.md'
const PLAN_3 = '# Exemple\n\n### T1 — Première\n\n### T2 — Deuxième\n\n### T3 — Troisième\n'
// Bloc meta (D:17484) et journal réel (quatre premières lignes de wf_0f41829b-6d3/journal.jsonl,
// chacune finie par son retour à la ligne).
const SCRIPT = "export const meta = { name: 'audit-disques', description: 'faire de la place', phases: [{ title: 'Review' }] }"
const WF_DIR =
  '/home/user/.claude/projects/-home-user-bridge-mcp/11111111-2222-4333-8444-555555555555/subagents/workflows/wf_0f41829b-6d3'
const JOURNAL_4 = [
  '{"type":"launched"}',
  '{"type":"started","key":"v2:d885cd372066bf210c715493729aa9cfcc90e795e9a167ea161134c9b4279533","agentId":"af6f3b628322fc241","label":"review:coverage","phase":"Review"}',
  '{"type":"started","key":"v2:fdbc6ff4edcfc67e73f95689f83b6279f51a038c8ed92a8f967a47db631aed5f","agentId":"ae24fa2f3e6f689fe","label":"review:consistency","phase":"Review"}',
  '{"type":"started","key":"v2:beba76af0c5af1fd8ec8e5f28b4d0a5f8a6c28a6be7a6d6b52637c7466c3997e","agentId":"a3634f40baec24679","label":"review:feasibility","phase":"Review"}',
  '',
].join('\n')
const WF_RESULT = {
  status: 'async_launched',
  taskId: 'wpt3f122w',
  taskType: 'local_workflow',
  workflowName: 'audit-disques',
  runId: 'wf_0f41829b-6d3',
  transcriptDir: WF_DIR,
} as const

// Résultats `Agent` de 2.1.300 (refs/engine-api.md §3.3, D:17513-17612) : seuls status et agentId comptent ;
// agentId réel du journal wf_0f41829b-6d3, autres champs aux valeurs d'exemple.
const AGENT_ID = 'af6f3b628322fc241'
const AGENT_LAUNCHED = {
  status: 'async_launched',
  agentId: AGENT_ID,
  description: 'Implement Task 3',
  prompt: 'You are implementing Task 3',
  outputFile: '/tmp/claude-1000/tasks/af6f3b628322fc241.output',
} as const
const AGENT_COMPLETED = { status: 'completed', agentId: AGENT_ID, content: [{ type: 'text', text: 'DONE' }], prompt: 'You are implementing Task 3' } as const
const agentEnd = { answer: 'DONE', durationMs: 4_000, isAborted: false, turnId: 'turn_a3', reason: 'answer', agentId: AGENT_ID } as const

const ok = (text: string) => ({ result: { result: { content: [] }, text, isReadOnly: true as const } })
const failed = (text: string) => ({ result: { result: text, text, isError: true as const } })

const BAND = { hasSurvey: false, isWorking: true, maxRows: 12, bodyColumns: 120, scroll: { bodyRows: 12, offset: 0 }, view: {} }

function mountBand($: Engine, props: Partial<typeof BAND> & { view?: { agentId?: string } } = {}) {
  return $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: { ...BAND, ...props } })
}

function mountGroup($: Engine, ids: (string | undefined)[], isExpanded: boolean) {
  const calls = ids.map(id => ({ tool_use_id: id, tool: 'Bash', input: {}, isRunning: false, isErrored: false, isInterrupted: false }))
  return $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'ToolGroup', props: { calls, isActive: false, isExpanded } })
}

/** La rangée d'un appel seul, où le mod met sa ligne : spec §10, « ToolResult levé ou non sous les lignes d'un groupe déplié ». */
function mountRow($: Engine, surface: (typeof SURFACES)[number], id: string, tool: string) {
  return $.ui.mount({
    plugin: PLUGIN,
    surface,
    component: 'ToolUse',
    requestId: id,
    props: { tool_use_id: id, tool, input: {}, isRunning: false, isErrored: false, isInterrupted: false, output: {} },
  })
}

/** Où vit l'étiquette `clair ✗ n` : spec §10, « SessionMode dessiné dans le terminal de l'utilisateur ». */
function mountMode($: Engine) {
  return $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'SessionMode', props: { modes: ['focus'] } })
}

async function superpowersTask($: Engine): Promise<void> {
  await $.tool.call({ tool: 'Skill', tool_use_id: 'toolu_s1', skill: 'superpowers:writing-plans' })
  await $.tool.call({ tool: 'Write', tool_use_id: 'toolu_w1', file_path: PLAN_PATH, content: PLAN_3 })
  await $.tool.call({ tool: 'Skill', tool_use_id: 'toolu_s2', skill: 'superpowers:subagent-driven-development' })
  await $.tool.call({ tool: 'Agent', tool_use_id: 'toolu_a1', description: 'Implement Task 2', prompt: 'You are implementing Task 2' })
}

// --- La bande au-dessus de la saisie --------------------------------------------------------

describe('ui.render AbovePrompt', () => {
  test('rien n’a eu lieu : la bande est celle du moteur', async ($, on) => {
    world(on)
    const ui = await mountBand($)
    expect(await ui.findAll({ type: 'Text' })).toHaveLength(1)
    expect(await ui.find({ type: 'Text', text: ENGINE_ROW })).toBeDefined()
    await ui.unmount()
  })

  test('au repos après un appel terminé : la bande est celle du moteur', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_1', ok(DF))
    await $.tool.call({ tool: 'mcp__ssh-bridge__ssh_disk_usage', tool_use_id: 'toolu_1', host: 'raspberry' })
    const ui = await mountBand($)
    expect(await ui.findAll({ type: 'Text' })).toHaveLength(1)
    await ui.unmount()
  })

  test('un appel en cours tient la bande sous le rendu du moteur, puis la bande se vide', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_1', { ...ok(DF), afterMs: 1_000 })
    const pending = $.tool.call({ tool: 'mcp__ssh-bridge__ssh_disk_usage', tool_use_id: 'toolu_1', host: 'raspberry' })
    await w.clock.settle()
    const ui = await mountBand($)
    expect(await ui.find({ type: 'Text', text: ENGINE_ROW })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /raspberry.*ssh_disk_usage/ })).toBeDefined()
    await w.clock.advance(1_000)
    await pending
    expect(await ui.findAll({ type: 'Text' })).toHaveLength(1)
    await ui.unmount()
  })

  test('la bande se dessine sur le vrai nœud du moteur : aucune Box à largeur ne le contient', async ($, on) => {
    // Capture réelle de la tâche 14 (etat-lecture, 2.1.300) : « ui.render (AbovePrompt): a hook returned a
    // tree that does not validate (engine node under a Box with prop "width"); drawing the engine's own ».
    const w = world(on)
    w.engineNodes.add('AbovePrompt')
    w.answers.set('toolu_1', { ...ok(DF), afterMs: 1_000 })
    const pending = $.tool.call({ tool: 'mcp__ssh-bridge__ssh_disk_usage', tool_use_id: 'toolu_1', host: 'raspberry' })
    await w.clock.settle()
    const ui = await mountBand($)
    expect(await ui.find({ type: 'Text', text: /raspberry.*ssh_disk_usage/ })).toBeDefined()
    const holders: string[] = []
    const walk = (node: unknown, widthAbove: boolean): void => {
      if (node === null || typeof node !== 'object') return
      const el = node as { type?: unknown; props?: Record<string, unknown>; children?: unknown[] }
      if (el.type === 'engine' && widthAbove) holders.push('nœud du moteur sous une Box à largeur')
      const width = widthAbove || (el.type === 'Box' && el.props?.width !== undefined)
      for (const child of el.children ?? []) walk(child, width)
    }
    walk(await ui.drawn(), false)
    expect(holders).toEqual([])
    await w.clock.advance(1_000)
    await pending
    await ui.unmount()
  })

  test('un appel en arrière-plan ne tient jamais la bande', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_bg', { result: { result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' }, text: '' }, afterMs: 1_000 })
    const pending = $.tool.call({ tool: 'Bash', tool_use_id: 'toolu_bg', command: 'bridge-mcp tool ssh_disk_usage host=raspberry', run_in_background: true })
    await w.clock.settle()
    const ui = await mountBand($)
    expect(await ui.findAll({ type: 'Text' })).toHaveLength(1)
    await w.clock.advance(1_000)
    await pending
    expect(await ui.findAll({ type: 'Text' })).toHaveLength(1)
    await ui.unmount()
  })

  test('un appel bridge pendant une tâche Superpowers : la bande montre l’appel et la tâche', async ($, on) => {
    const w = world(on)
    await superpowersTask($)
    w.answers.set('toolu_1', { ...ok(DF), afterMs: 1_000 })
    const pending = $.tool.call({ tool: 'mcp__ssh-bridge__ssh_disk_usage', tool_use_id: 'toolu_1', host: 'raspberry' })
    await w.clock.settle()
    const ui = await mountBand($)
    expect(await ui.find({ type: 'Text', text: /raspberry.*ssh_disk_usage/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /tâche 2 sur 3/ })).toBeDefined()
    await w.clock.advance(1_000)
    await pending
    await ui.unmount()
    const group = await mountGroup($, ['toolu_1'], false)
    expect(await group.find({ type: 'Text', text: /raspberry.*ssh_disk_usage/ })).toBeDefined()
    await group.unmount()
  })

  test('l’étape Superpowers seulement pendant que Claude travaille', async ($, on) => {
    world(on)
    await superpowersTask($)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND })
      expect(await ui.find({ type: 'Text', text: /tâche 2 sur 3/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /coder|rien à faire/ })).toBeUndefined()
      await ui.unmount()
    }
    const idle = await mountBand($, { isWorking: false })
    expect(await idle.findAll({ type: 'Text' })).toHaveLength(1)
    await idle.unmount()
  })

  // Captures etat-superpowers (tâche 14) : en 2.1.300 l'agent part en arrière-plan et le tour principal finit.
  test('un agent lancé en arrière-plan sous le plan garde l’étape dans la bande au repos, jusqu’à la fin de sa boucle', async ($, on) => {
    const w = world(on)
    await superpowersTask($)
    w.answers.set('toolu_a3', { result: { result: AGENT_LAUNCHED, text: 'Async agent launched successfully.' } })
    await $.tool.call({ tool: 'Agent', tool_use_id: 'toolu_a3', description: 'Implement Task 3', prompt: 'You are implementing Task 3' })
    const ui = await mountBand($, { isWorking: false })
    expect(await ui.find({ type: 'Text', text: /tâche 3 sur 3/ })).toBeDefined()
    await $.turn.complete(agentEnd)
    expect(await ui.findAll({ type: 'Text' })).toHaveLength(1)
    await ui.unmount()
  })

  // Ordre de 2.1.300 : le turn.complete d'un sous-agent part à la fin de sa boucle, avant le résultat `completed`.
  test('un agent au premier plan, fini avant son résultat, ne laisse jamais l’étape dans la bande au repos', async ($, on) => {
    const w = world(on)
    await superpowersTask($)
    w.answers.set('toolu_a3', { result: { result: AGENT_COMPLETED, text: 'DONE' }, afterMs: 1_000 })
    const pending = $.tool.call({ tool: 'Agent', tool_use_id: 'toolu_a3', description: 'Implement Task 3', prompt: 'You are implementing Task 3' })
    await w.clock.settle()
    await $.turn.complete(agentEnd)
    await w.clock.advance(1_000)
    await pending
    const ui = await mountBand($, { isWorking: false })
    expect(await ui.findAll({ type: 'Text' })).toHaveLength(1)
    expect(lastState(w)?.superpowers).toMatchObject({ stage: 'taches', current: 3, runningAgents: [] })
    await ui.unmount()
  })

  test('un sondage tient la bande : le mod laisse la place', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_1', { ...ok(DF), afterMs: 1_000 })
    const pending = $.tool.call({ tool: 'mcp__ssh-bridge__ssh_disk_usage', tool_use_id: 'toolu_1', host: 'raspberry' })
    await w.clock.settle()
    const ui = await mountBand($, { hasSurvey: true })
    expect(await ui.findAll({ type: 'Text' })).toHaveLength(1)
    await w.clock.advance(1_000)
    await pending
    await ui.unmount()
  })

  test('vue d’un sous-agent : ni plan ni workflow', async ($, on) => {
    world(on)
    await superpowersTask($)
    const ui = await mountBand($, { view: { agentId: 'agent-1' } })
    expect(await ui.findAll({ type: 'Text' })).toHaveLength(1)
    await ui.unmount()
  })

  test('un workflow qui tourne : sa ligne, puis sa phase quand le journal la donne', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_wf', { result: { result: WF_RESULT, text: '' } })
    await $.tool.call({ tool: 'Workflow', tool_use_id: 'toolu_wf', script: SCRIPT })
    const ui = await mountBand($)
    expect(await ui.find({ type: 'Text', text: /workflow audit-disques/ })).toBeDefined()
    writeFile(w, `${WF_DIR}/journal.jsonl`, JOURNAL_4)
    await w.clock.advance(3_000)
    expect(await ui.find({ type: 'Text', text: /Review/ })).toBeDefined()
    await ui.unmount()
  })

  test('« à toi » prend la première ligne pendant le formulaire', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_f', { ...ok('active'), afterMs: 1_000 })
    const pending = $.tool.call({ tool: 'mcp__ssh-bridge__ssh_exec', tool_use_id: 'toolu_f', host: 'raspberry', command: 'systemctl restart nginx' })
    await w.clock.settle()
    await $.classic.Elicitation({ mcp_server_name: 'ssh-bridge', message: CONFIRM_EXEC, mode: 'form' })
    const ui = await mountBand($)
    expect(await ui.find({ type: 'Text', text: /à toi.*raspberry/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /ssh_exec/ })).toBeUndefined()
    await w.clock.advance(1_000)
    await pending
    await ui.unmount()
  })
})

// --- Sous les appels -------------------------------------------------------------------------

describe('ui.render des rangées d’appels', () => {
  test('un appel seul : sa ligne avec le rendu du moteur, sur chaque surface', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_read', ok(DF))
    await $.tool.call({ tool: 'mcp__ssh-bridge__ssh_disk_usage', tool_use_id: 'toolu_read', host: 'raspberry' })
    for (const surface of SURFACES) {
      const ui = await mountRow($, surface, 'toolu_read', 'mcp__ssh-bridge__ssh_disk_usage')
      expect(await ui.find({ type: 'Text', text: /raspberry.*ssh_disk_usage.*lecture/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: ENGINE_ROW })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /liste noire/ })).toBeUndefined()
      // Variante R2 : la ligne du mod sous la rangée de l'appel dessinée par le moteur (ordre du document).
      const order = (await ui.findAll({ type: 'Text' })).map(t => t.text)
      expect(order[0]).toBe(ENGINE_ROW)
      expect(order[1]).toMatch(/raspberry.*ssh_disk_usage/)
      await ui.unmount()
    }
  })

  // Spec §6 : la rangée lit le membre `rows` de son tool_use_id ; l'écriture de fin la redessine.
  test('une rangée suivie suit son appel : en cours, puis injoignable quand il se termine', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_run', { ...failed(SSH_REFUSED), afterMs: 1_000 })
    const pending = $.tool.call({ tool: 'mcp__ssh-bridge__ssh_disk_usage', tool_use_id: 'toolu_run', host: 'raspberry' })
    await w.clock.settle()
    const ui = await mountRow($, 'terminal', 'toolu_run', 'mcp__ssh-bridge__ssh_disk_usage')
    expect(await ui.find({ type: 'Text', text: /^● raspberry · ssh_disk_usage/ })).toBeDefined()
    await w.clock.advance(1_000)
    await pending
    expect(await ui.find({ type: 'Text', text: /^✗ raspberry · injoignable/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^●/ })).toBeUndefined()
    await ui.unmount()
  })

  // Captures etat-a-toi (tâche 14) : le formulaire cache la bande et la ligne d'état, seule la rangée
  // de l'appel reste visible ; pendant l'attente, c'est elle qui dit « attend ton accord ».
  test('pendant le formulaire, la rangée de l’appel attend ton accord, puis redevient la ligne de l’appel', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_f', { ...ok('active'), afterMs: 1_000 })
    const pending = $.tool.call({ tool: 'mcp__ssh-bridge__ssh_exec', tool_use_id: 'toolu_f', host: 'raspberry', command: 'systemctl restart nginx' })
    await w.clock.settle()
    const ui = await mountRow($, 'terminal', 'toolu_f', 'mcp__ssh-bridge__ssh_exec')
    expect(await ui.find({ type: 'Text', text: /^● raspberry · ssh_exec$/ })).toBeDefined()
    await $.classic.Elicitation({ mcp_server_name: 'ssh-bridge', message: CONFIRM_EXEC, mode: 'form' })
    expect(await ui.find({ type: 'Text', text: new RegExp(`^${WAIT_SIGN} raspberry · ssh_exec · attend ton accord$`) })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^●/ })).toBeUndefined()
    await $.classic.ElicitationResult({ mcp_server_name: 'ssh-bridge', action: 'accept', content: { confirm: true } })
    expect(await ui.find({ type: 'Text', text: /^● raspberry · ssh_exec$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /attend ton accord/ })).toBeUndefined()
    await w.clock.advance(1_000)
    await pending
    expect(await ui.find({ type: 'Text', text: /^✓ raspberry · ssh_exec/ })).toBeDefined()
    await ui.unmount()
  })

  test('un refus de la liste noire : refusé, sur sa machine', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_deny', failed(DENIED))
    await $.tool.call({ tool: 'mcp__ssh-bridge__ssh_exec', tool_use_id: 'toolu_deny', host: 'raspberry', command: 'shutdown now' })
    const ui = await mountRow($, 'terminal', 'toolu_deny', 'mcp__ssh-bridge__ssh_exec')
    expect(await ui.find({ type: 'Text', text: /raspberry.*refusé/ })).toBeDefined()
    await ui.unmount()
  })

  test('la rangée d’un autre outil reste celle du moteur et ne lit pas l’état', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_b', ok(DF))
    w.answers.set('toolu_c', ok(DF))
    await $.tool.call({ tool: 'mcp__ssh-bridge__ssh_disk_usage', tool_use_id: 'toolu_b', host: 'raspberry' })
    const other = await mountRow($, 'terminal', 'toolu_other', 'Read')
    const tracked = await mountRow($, 'terminal', 'toolu_b', 'mcp__ssh-bridge__ssh_disk_usage')
    await $.tool.call({ tool: 'mcp__ssh-bridge__ssh_disk_usage', tool_use_id: 'toolu_c', host: 'raspberry' })
    expect(await other.findAll({ type: 'Text' })).toHaveLength(1)
    expect(await tracked.find({ type: 'Text', text: ENGINE_ROW })).toBeDefined()
    // Témoin : une rangée suivie lit l'état, elle est redessinée après l'écriture ; l'autre ne l'est pas.
    expect(w.drawn.filter(d => d.endsWith(':toolu_b')).length).toBeGreaterThan(1)
    expect(w.drawn.filter(d => d.endsWith(':toolu_other'))).toHaveLength(1)
    await other.unmount()
    await tracked.unmount()
  })

  test('groupe replié : la ligne du moteur, puis une ligne par appel bridge suivi', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_cli', { result: { result: { stdout: DF, stderr: '', interrupted: false }, text: DF } })
    w.answers.set('toolu_ls', { result: { result: { stdout: 'README.md', stderr: '', interrupted: false }, text: 'README.md' } })
    w.answers.set('toolu_mcp', ok(DF))
    await $.tool.call({ tool: 'Bash', tool_use_id: 'toolu_cli', command: 'bridge-mcp tool ssh_disk_usage host=raspberry' })
    await $.tool.call({ tool: 'Bash', tool_use_id: 'toolu_ls', command: 'ls' })
    await $.tool.call({ tool: 'mcp__ssh-bridge__ssh_disk_usage', tool_use_id: 'toolu_mcp', host: 'raspberry' })
    const ui = await mountGroup($, ['toolu_cli', 'toolu_ls', 'toolu_mcp'], false)
    expect(await ui.find({ type: 'Text', text: ENGINE_ROW })).toBeDefined()
    expect(await ui.findAll({ type: 'Text', text: /raspberry.*ssh_disk_usage/ })).toHaveLength(2)
    await ui.unmount()
  })

  test('groupe déplié : le groupe reste celui du moteur, la ligne est sous la rangée de l’appel', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_mcp', ok(DF))
    await $.tool.call({ tool: 'mcp__ssh-bridge__ssh_disk_usage', tool_use_id: 'toolu_mcp', host: 'raspberry' })
    const group = await mountGroup($, ['toolu_mcp'], true)
    expect(await group.findAll({ type: 'Text' })).toHaveLength(1)
    await group.unmount()
    const row = await mountRow($, 'terminal', 'toolu_mcp', 'mcp__ssh-bridge__ssh_disk_usage')
    expect(await row.find({ type: 'Text', text: /raspberry.*ssh_disk_usage/ })).toBeDefined()
    await row.unmount()
  })

  test('groupe dont les appels n’ont pas de tool_use_id : le moteur seul', async ($, on) => {
    world(on)
    const ui = await mountGroup($, [undefined, undefined], false)
    expect(await ui.findAll({ type: 'Text' })).toHaveLength(1)
    await ui.unmount()
  })

  test('groupe sans appel bridge : le moteur seul, sans lire l’état', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_ls', { result: { result: { stdout: 'README.md', stderr: '', interrupted: false }, text: 'README.md' } })
    w.answers.set('toolu_c', ok(DF))
    await $.tool.call({ tool: 'Bash', tool_use_id: 'toolu_ls', command: 'ls' })
    const ui = await mountGroup($, ['toolu_ls'], false)
    await $.tool.call({ tool: 'mcp__ssh-bridge__ssh_disk_usage', tool_use_id: 'toolu_c', host: 'raspberry' })
    expect(await ui.findAll({ type: 'Text' })).toHaveLength(1)
    expect(w.drawn.filter(d => d.startsWith('ToolGroup:'))).toHaveLength(1)
    await ui.unmount()
  })
})

// --- Étiquette et apparence ---------------------------------------------------------------

describe('ui.render SessionMode et apparence', () => {
  test('l’étiquette clair ✗ 1 après un problème, plus rien après /clair', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_down', failed(SSH_REFUSED))
    const quiet = await mountMode($)
    expect(await quiet.find({ type: 'Text', text: /clair ✗/ })).toBeUndefined()
    await quiet.unmount()
    await $.tool.call({ tool: 'mcp__ssh-bridge__ssh_disk_usage', tool_use_id: 'toolu_down', host: 'raspberry' })
    const ui = await mountMode($)
    expect(await ui.find({ type: 'Text', text: /clair ✗ 1/ })).toBeDefined()
    await $.command.run({ command: 'clair', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })
    expect(await ui.find({ type: 'Text', text: /clair ✗/ })).toBeUndefined()
    await ui.unmount()
  })

  test('chaque Text du mod : coupé en fin de ligne, sans fond, sans inversion, sans gras ; la machine dans sa couleur', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_1', { ...ok(DF), afterMs: 1_000 })
    const pending = $.tool.call({ tool: 'mcp__ssh-bridge__ssh_disk_usage', tool_use_id: 'toolu_1', host: 'raspberry' })
    await w.clock.settle()
    const band = await mountBand($)
    const texts = [...(await band.findAll({ type: 'Text' }))]
    await w.clock.advance(1_000)
    await pending
    const row = await mountRow($, 'terminal', 'toolu_1', 'mcp__ssh-bridge__ssh_disk_usage')
    texts.push(...(await row.findAll({ type: 'Text' })))
    const mine = texts.filter(t => t.text !== ENGINE_ROW)
    expect(mine.length).toBeGreaterThan(0)
    for (const t of mine) {
      expect(t.props.wrap).toBe('truncate-end')
      expect(t.props.backgroundColor).toBeUndefined()
      expect(t.props.inverse).toBeUndefined()
      expect(t.props.bold).toBeUndefined()
      expect(t.props.weight).toBeUndefined()
    }
    expect(mine.filter(t => t.text === 'raspberry').map(t => t.props.color)).toContain(colorOf(0))
    await band.unmount()
    await row.unmount()
  })
})
