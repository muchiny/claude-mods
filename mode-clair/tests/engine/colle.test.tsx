// Tests moteur issus de la mutation de la colle (dev/mutate-glue.mjs) : chacun tue au moins un
// mutant de register.tsx qui survivait aux autres tests moteur (identifiant du mutant en commentaire,
// L<ligne>C<colonne>-<famille>, relevé sur register.tsx de mode-clair 0.2.0).
import type { Engine } from 'claude-code/testing'
import { describe, expect, test } from 'claude-code/testing'
import { colorOf } from '../../hooks/colors'
import { STALE_MS } from '../../hooks/superpowers'
import { callLine, fit, parseCard } from '../../hooks/view'
import { QUIET_MS } from '../../hooks/workflow'
import type { Line, Tone } from '../../types'
import { ENGINE_ROW, lastState, PLUGIN, world, writeFile } from './world'

// --- Fixtures (sources : voir tests/engine/events.test.tsx) ---------------------------------

const DF = 'Filesystem Size Used Avail Use% Mounted\n/dev/sda1 10G 5G 5G 50% /\n'
const SSH_REFUSED = 'SSH connection failed to raspberry: Connection refused (os error 111)'
const CONFIRM_EXEC =
  'Confirm destructive operation: `ssh_exec`\n\n**Arguments:**\n```json\n{"command":"systemctl restart nginx","host":"raspberry"}\n```\n\n**Command:**\n```sh\nsystemctl restart nginx\n```\n\nProceed?'
const SCRIPT =
  "export const meta = { name: 'audit-disques', description: 'faire de la place', phases: [{ title: 'Review' }] }"
const WF_DIR =
  '/home/user/.claude/projects/-home-user-bridge-mcp/11111111-2222-4333-8444-555555555555/subagents/workflows/wf_0f41829b-6d3'
const JOURNAL = `${WF_DIR}/journal.jsonl`
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
// Un second workflow local, avec son journal, et un troisième sans transcriptDir (donc sans journal).
const WF2_DIR = WF_DIR.replace('wf_0f41829b-6d3', 'wf_2')
const WF2_RESULT = { ...WF_RESULT, taskId: 't2', runId: 'wf_2', transcriptDir: WF2_DIR } as const
const WF_BARE = { status: 'async_launched', taskId: 't3', taskType: 'local_workflow', runId: 'wf_3' } as const
const NOTICE =
  '<task-notification>\n<task-id>wpt3f122w</task-id>\n<tool-use-id>toolu_wf</tool-use-id>\n<output-file>/tmp/claude-1000/tasks/wpt3f122w.output</output-file>\n<status>completed</status>\n<summary>Dynamic workflow "audit-disques" completed</summary>\n</task-notification>'
// Un nom de machine plus long que 81 colonnes : la ligne est coupée à la largeur de repli (80).
const LONG_HOST = `serveur-${'x'.repeat(90)}`

const ok = (text: string) => ({ result: { result: { content: [] }, text, isReadOnly: true as const } })
const failed = (text: string) => ({ result: { result: text, text, isError: true as const } })
const textOf = (line: Line) => line.map((p) => p.text).join('')

async function startWorkflow($: Engine, id: string) {
  return $.tool.call({ tool: 'Workflow', tool_use_id: id, script: SCRIPT })
}

async function endWorkflow($: Engine) {
  await $.session.append({
    message: { type: 'user', content: [{ type: 'text', text: NOTICE }] },
    door: 'delivery',
    origin: { kind: 'task-notification' },
    uuid: 'row-1',
  })
}

async function runClair($: Engine): Promise<string> {
  const ran = await $.command.run({
    command: 'clair',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })
  return ran.text ?? ''
}

// --- Chaque hook transmet la réponse du cœur ----------------------------------------------

describe('colle : la réponse du cœur traverse le mod', () => {
  // L87C12-next, L130C12-next, L138C12-next, L146C12-next, L157C12-next
  test('session.start, PermissionDenied, Elicitation, ElicitationResult, turn.complete : réponse du cœur inchangée', async ($, on) => {
    world(on)
    expect(await $.session.start({ cwd: '/home/user', surface: null, isInteractive: true })).toEqual({
      cwd: '/home/user',
    })
    expect(
      await $.classic.PermissionDenied({
        tool_name: 'mcp__ssh-bridge__ssh_exec',
        tool_input: { host: 'raspberry' },
        tool_use_id: 'toolu_x',
        reason: 'classifier',
      }),
    ).toEqual({})
    expect(await $.classic.Elicitation({ mcp_server_name: 'ssh-bridge', message: CONFIRM_EXEC, mode: 'form' })).toEqual(
      {},
    )
    expect(await $.classic.ElicitationResult({ mcp_server_name: 'ssh-bridge', action: 'decline' })).toEqual({})
    expect(
      await $.turn.complete({ answer: 'fin', durationMs: 0, isAborted: false, turnId: 't1', reason: 'answer' }),
    ).toEqual({ text: 'fin' })
  })
})

// --- Formulaires, Skill, Workflow ----------------------------------------------------------

describe('colle : ce que chaque hook ne doit pas noter', () => {
  // L144C9-if-true
  test('la réponse au formulaire d’un autre serveur ne touche ni l’attente ni l’accord du bridge', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_f', { ...ok(DF), afterMs: 1_000 })
    const pending = $.tool.call({
      tool: 'mcp__ssh-bridge__ssh_exec',
      tool_use_id: 'toolu_f',
      host: 'raspberry',
      command: 'systemctl restart nginx',
    })
    await w.clock.settle()
    await $.classic.Elicitation({ mcp_server_name: 'ssh-bridge', message: CONFIRM_EXEC, mode: 'form' })
    await $.classic.ElicitationResult({ mcp_server_name: 'github', action: 'accept', content: { confirm: true } })
    expect(lastState(w)?.waiting).toMatchObject({ callId: 'toolu_f#0' })
    expect(lastState(w)?.calls).toMatchObject([{ accord: 'aucun' }])
    await w.clock.advance(1_000)
    await pending
  })

  // L164C9-if-false
  test('un Skill en erreur n’ouvre aucune étape Superpowers', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_s', failed('Unknown skill'))
    await $.tool.call({ tool: 'Skill', tool_use_id: 'toolu_s', skill: 'superpowers:writing-plans' })
    expect(w.state).toBeUndefined()
  })

  // L201C32-op
  test('un résultat Workflow isError, sans champ error : aucun workflow', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_wf', { result: { result: WF_RESULT, text: '', isError: true } })
    await startWorkflow($, 'toolu_wf')
    expect(w.state).toBeUndefined()
  })

  // L204C36-op
  test('un script en ligne : result.scriptPath n’est pas lu', async ($, on) => {
    const w = world(on)
    writeFile(w, `${WF_DIR}/script.mjs`, SCRIPT)
    w.answers.set('toolu_wf', { result: { result: { ...WF_RESULT, scriptPath: `${WF_DIR}/script.mjs` }, text: '' } })
    await startWorkflow($, 'toolu_wf')
    expect(lastState(w)?.workflows).toMatchObject([{ phases: ['Review'] }])
    expect(w.reads).toEqual([])
  })

  // L207C33-op
  test('un workflow local sans transcriptDir : aucun chemin de journal inventé', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_wb', { result: { result: WF_BARE, text: '' } })
    await startWorkflow($, 'toolu_wb')
    expect(lastState(w)?.workflows).toMatchObject([{ key: 'wf_3', journalPath: null, status: 'en-cours' }])
    await w.clock.advance(6_000)
    expect(w.stats).toEqual([])
  })
})

// --- Minuteur du journal --------------------------------------------------------------------

describe('colle : le minuteur du journal', () => {
  // L67C20-minus
  test('un tic toutes les 3 s, pas avant', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_wf', { result: { result: WF_RESULT, text: '' } })
    await startWorkflow($, 'toolu_wf')
    writeFile(w, JOURNAL, JOURNAL_4)
    await w.clock.advance(2_999)
    expect(w.stats).toEqual([])
    await w.clock.advance(1)
    expect(w.stats).toEqual([JOURNAL])
  })

  // L404C7-if-true, L404C29-op
  test('deux workflows : un seul minuteur, un stat par journal et par tic', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_wf', { result: { result: WF_RESULT, text: '' } })
    w.answers.set('toolu_w2', { result: { result: WF2_RESULT, text: '' } })
    await startWorkflow($, 'toolu_wf')
    await startWorkflow($, 'toolu_w2')
    await w.clock.advance(3_000)
    expect([...w.stats].sort()).toEqual([JOURNAL, `${WF2_DIR}/journal.jsonl`].sort())
  })

  // L229C114-op, L229C118-plus
  test('la fin d’un workflow laisse le minuteur à celui qui tourne encore', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_wf', { result: { result: WF_RESULT, text: '' } })
    w.answers.set('toolu_w2', { result: { result: WF2_RESULT, text: '' } })
    await startWorkflow($, 'toolu_wf')
    await startWorkflow($, 'toolu_w2')
    await endWorkflow($)
    await w.clock.advance(3_000)
    expect(w.stats).toEqual([`${WF2_DIR}/journal.jsonl`])
  })

  // L229C118-minus, L404C51-minus (et L404C7-if-true, L404C29-op) :
  // sans journal suivi, aucun tic ne tourne, donc rien ne conclut « sans nouvelles » d'un workflow
  // dont on n'a aucun journal.
  test('quand le dernier journal suivi s’arrête, le minuteur s’arrête aussitôt et session.start ne le relance pas', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_wf', { result: { result: WF_RESULT, text: '' } })
    w.answers.set('toolu_wb', { result: { result: WF_BARE, text: '' } })
    await startWorkflow($, 'toolu_wf')
    await startWorkflow($, 'toolu_wb')
    // Juste après le dernier tic avant QUIET_MS : le tic suivant tomberait à QUIET_MS pile.
    await w.clock.advance(QUIET_MS - 2_000)
    expect(lastState(w)?.workflows.find((x) => x.key === 'wf_3')).toMatchObject({ status: 'en-cours' })
    await endWorkflow($)
    await w.clock.advance(10_000)
    expect(lastState(w)?.workflows.find((x) => x.key === 'wf_3')).toMatchObject({ status: 'en-cours' })
    await $.session.start({ cwd: '/home/user', surface: null, isInteractive: true })
    await w.clock.advance(10_000)
    expect(lastState(w)?.workflows.find((x) => x.key === 'wf_3')).toMatchObject({ status: 'en-cours' })
  })

  // L431C7-if-false, L431C32-minus
  test('le dernier journal suivi passe « sans nouvelles » : le minuteur s’arrête à ce tic', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_wf', { result: { result: WF_RESULT, text: '' } })
    w.answers.set('toolu_wb', { result: { result: WF_BARE, text: '' } })
    await startWorkflow($, 'toolu_wf')
    await w.clock.advance(10_000)
    await startWorkflow($, 'toolu_wb')
    await w.clock.advance(QUIET_MS + 20_000)
    expect(lastState(w)?.workflows.find((x) => x.key === WF_RESULT.runId)).toMatchObject({
      status: 'sans-nouvelles',
    })
    expect(lastState(w)?.workflows.find((x) => x.key === 'wf_3')).toMatchObject({ status: 'en-cours' })
  })

  // L420C9-if-false
  test('journal absent : le tic continue et le workflow passe « sans nouvelles » après QUIET_MS', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_wf', { result: { result: WF_RESULT, text: '' } })
    await startWorkflow($, 'toolu_wf')
    await w.clock.advance(QUIET_MS)
    expect(lastState(w)?.workflows).toMatchObject([{ status: 'sans-nouvelles' }])
  })

  // L424C9-if-false
  test('une lecture refusée du journal est retentée au tic suivant', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_wf', { result: { result: WF_RESULT, text: '' } })
    await startWorkflow($, 'toolu_wf')
    writeFile(w, JOURNAL, JOURNAL_4)
    w.unreadable.add(JOURNAL)
    await w.clock.advance(3_000)
    expect(w.reads).toEqual([JOURNAL])
    w.unreadable.delete(JOURNAL)
    await w.clock.advance(3_000)
    expect(w.reads).toEqual([JOURNAL, JOURNAL])
    expect(lastState(w)?.workflows[0]?.agents).toHaveLength(3)
  })

  // L429C20-minus
  test('un tic sans changement n’écrit pas l’état', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_wf', { result: { result: WF_RESULT, text: '' } })
    await startWorkflow($, 'toolu_wf')
    writeFile(w, JOURNAL, JOURNAL_4)
    await w.clock.advance(3_000)
    const writes = w.stateWrites
    await w.clock.advance(9_000)
    expect(w.stats).toHaveLength(4)
    expect(w.stateWrites).toBe(writes)
  })
})

// --- Écritures : état, rangées, ligne d'état, minuteur Superpowers ------------------------------

describe('colle : écrire seulement ce qui change', () => {
  // L332C36-if-true
  test('un appel ne réécrit que sa propre rangée', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_1', ok(DF))
    w.answers.set('toolu_2', ok(DF))
    await $.tool.call({ tool: 'mcp__ssh-bridge__ssh_disk_usage', tool_use_id: 'toolu_1', host: 'raspberry' })
    const before = w.rowWrites.length
    await $.tool.call({ tool: 'mcp__ssh-bridge__ssh_disk_usage', tool_use_id: 'toolu_2', host: 'raspberry' })
    const after = w.rowWrites.slice(before)
    expect(after.length).toBeGreaterThan(0)
    expect(after.every((id) => id === 'toolu_2')).toBe(true)
  })

  // L335C7-if-true
  test('la ligne d’état n’est reposée que si son texte change', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_1', ok(DF))
    await $.session.start({ cwd: '/home/user', surface: null, isInteractive: true })
    expect(w.status).toHaveLength(1)
    await $.tool.call({ tool: 'mcp__ssh-bridge__ssh_disk_usage', tool_use_id: 'toolu_1', host: 'raspberry' })
    expect(w.status).toHaveLength(1)
  })

  // L387C17-op
  test('Superpowers abandonné : plus aucun minuteur ne tourne', async ($, on) => {
    const w = world(on)
    await $.tool.call({ tool: 'Skill', tool_use_id: 'toolu_s', skill: 'superpowers:writing-plans' })
    await w.clock.advance(STALE_MS)
    expect(lastState(w)?.superpowers).toMatchObject({ isStale: true })
    const reads = w.stateReads
    await w.clock.advance(1_000)
    expect(w.stateReads).toBe(reads)
  })
})

// --- Rendus ---------------------------------------------------------------------------------

/** Les lignes que le mod dessine : chaque Text enfant direct de sa Box, avec ses morceaux. */
type Drawn = { type?: unknown; props?: Record<string, unknown>; children?: unknown[] }
function drawnLines(tree: unknown): Drawn[] {
  const root = tree as Drawn
  return (root.children ?? []).filter((c): c is Drawn => (c as Drawn)?.type === 'Text')
}
function plain(node: unknown): string {
  if (typeof node === 'string') return node
  return ((node as Drawn)?.children ?? []).map(plain).join('')
}
// Le contrat des tons (register.tsx, draw) : ok success, erreur error, attention warning, accent claude,
// atténué dimColor, texte rien, machine sa couleur.
function expected(tone: Tone): { color?: string; dimColor?: boolean } {
  if (typeof tone === 'object') return { color: colorOf(tone.machine) }
  if (tone === 'attenue') return { dimColor: true }
  if (tone === 'texte') return {}
  return { color: { ok: 'success', erreur: 'error', attention: 'warning', accent: 'claude' }[tone] }
}

describe('colle : rendus', () => {
  // L246C9-if-false, L246C26-minus
  test('rien à montrer : la bande est exactement celle du moteur, sans Box du mod', async ($, on) => {
    world(on)
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'terminal',
      component: 'AbovePrompt',
      props: {
        hasSurvey: false,
        isWorking: true,
        maxRows: 12,
        bodyColumns: 120,
        scroll: { bodyRows: 12, offset: 0 },
        view: {},
      },
    })
    expect(await ui.drawn()).toMatchObject({ type: 'Text', children: [ENGINE_ROW] })
    await ui.unmount()
  })

  // L298C9-if-false, L298C26-minus
  test('une sortie /clair vide : celle du moteur, sans Box du mod', async ($, on) => {
    world(on)
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'terminal',
      component: 'CommandOutput',
      props: { command: 'clair', args: '', text: '', isErrored: false },
    })
    expect(await ui.drawn()).toMatchObject({ type: 'Text', children: [ENGINE_ROW] })
    await ui.unmount()
  })

  // L309C9-if-false
  test('sans problème non vu : les modes du moteur, sans étiquette ajoutée', async ($, on) => {
    world(on)
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'terminal',
      component: 'SessionMode',
      props: { modes: ['focus'] },
    })
    expect(await ui.drawn()).toMatchObject({ type: 'Text', children: ['focus'] })
    await ui.unmount()
  })

  // L272C78-plus, L272C78-minus
  test('rangée ToolUse sans viewport : la ligne est coupée à 80 colonnes', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_l', ok(DF))
    await $.tool.call({ tool: 'mcp__ssh-bridge__ssh_disk_usage', tool_use_id: 'toolu_l', host: LONG_HOST })
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'terminal',
      component: 'ToolUse',
      requestId: 'toolu_l',
      props: {
        tool_use_id: 'toolu_l',
        tool: 'mcp__ssh-bridge__ssh_disk_usage',
        input: {},
        isRunning: false,
        isErrored: false,
        isInterrupted: false,
        output: {},
      },
    })
    const call = w.rows.get('toolu_l')?.[0]
    const s = lastState(w)
    if (call === undefined || s === undefined) throw new Error('appel non suivi')
    expect(textOf(callLine(call, s, 81))).not.toBe(textOf(callLine(call, s, 80)))
    expect(drawnLines(await ui.drawn()).map(plain)).toContain(textOf(callLine(call, s, 80)))
    await ui.unmount()
  })

  // L290C78-plus, L290C78-minus
  test('groupe replié sans viewport : la ligne est coupée à 80 colonnes', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_l', ok(DF))
    await $.tool.call({ tool: 'mcp__ssh-bridge__ssh_disk_usage', tool_use_id: 'toolu_l', host: LONG_HOST })
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'terminal',
      component: 'ToolGroup',
      props: {
        calls: [
          {
            tool_use_id: 'toolu_l',
            tool: 'mcp__ssh-bridge__ssh_disk_usage',
            input: {},
            isRunning: false,
            isErrored: false,
            isInterrupted: false,
          },
        ],
        isActive: false,
        isExpanded: false,
      },
    })
    const call = w.rows.get('toolu_l')?.[0]
    const s = lastState(w)
    if (call === undefined || s === undefined) throw new Error('appel non suivi')
    expect(drawnLines(await ui.drawn()).map(plain)).toContain(textOf(callLine(call, s, 80)))
    await ui.unmount()
  })

  // L302C77-plus, L302C77-minus
  test('carte /clair sans viewport : chaque ligne est coupée à 80 colonnes', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_l', failed(SSH_REFUSED))
    await $.tool.call({ tool: 'mcp__ssh-bridge__ssh_disk_usage', tool_use_id: 'toolu_l', host: LONG_HOST })
    const text = await runClair($)
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'terminal',
      component: 'CommandOutput',
      props: { command: 'clair', args: '', text, isErrored: false },
    })
    const rows = parseCard(text).map((line) => textOf(fit(line, 80, true)))
    expect(rows.some((row, i) => row !== textOf(fit(parseCard(text)[i] ?? [], 81, true)))).toBe(true)
    expect(drawnLines(await ui.drawn()).map(plain)).toEqual(rows)
    await ui.unmount()
  })

  // L456C7-if-true, L458C15-op, L458C57-op
  test('chaque morceau de la carte porte le ton du contrat', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_1', ok(DF))
    w.answers.set('toolu_2', failed(SSH_REFUSED))
    await $.tool.call({ tool: 'mcp__ssh-bridge__ssh_disk_usage', tool_use_id: 'toolu_1', host: 'raspberry' })
    await $.tool.call({ tool: 'mcp__ssh-bridge__ssh_disk_usage', tool_use_id: 'toolu_2', host: 'raspberry' })
    const text = await runClair($)
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'terminal',
      component: 'CommandOutput',
      viewport: { columns: 200, rows: 40 },
      props: { command: 'clair', args: '', text, isErrored: false },
    })
    const lines = parseCard(text).map((line) => fit(line, 200))
    const drawn = drawnLines(await ui.drawn())
    expect(drawn).toHaveLength(lines.length)
    const tones = new Set<string>()
    lines.forEach((line, i) => {
      const pieces = (drawn[i]?.children ?? []) as Drawn[]
      expect(pieces).toHaveLength(line.length)
      line.forEach((piece, k) => {
        tones.add(typeof piece.tone === 'object' ? 'machine' : piece.tone)
        const props = pieces[k]?.props ?? {}
        const want = expected(piece.tone)
        expect({ color: props.color, dimColor: props.dimColor }).toEqual({
          color: want.color,
          dimColor: want.dimColor,
        })
      })
    })
    // Le témoin couvre les trois branches : machine, atténué, texte, et un ton coloré.
    expect(tones.has('machine') && tones.has('attenue') && tones.has('texte')).toBe(true)
    expect(tones.has('ok') || tones.has('erreur')).toBe(true)
    await ui.unmount()
  })
})
