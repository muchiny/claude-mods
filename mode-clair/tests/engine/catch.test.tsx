// Les mutants « équivalents » de la colle de la famille -next (return next(e) → return { ...e })
// et L227C9-if-false (lever après next) reposent sur une règle du moteur : un hook qui rend une
// forme fausse ou qui lève passe par son `.catch` (ou, sans .catch, est sauté), et ce qui est sous
// lui répond à sa place (D:4037, CatchHandler D:1199). Ces tests l'épinglent :
// - côté moteur, avec un hook du test qui rend une forme fausse (async et synchrone) ;
// - côté mod, dans la situation exacte de chaque mutant : même réponse, le cœur atteint une seule
//   fois, rien d'écrit. Ils passent sur l'original et sur chacun de ces mutants (vérifié par
//   `node dev/mutate-glue.mjs --only <id>`) : si l'un d'eux tombe, le mutant n'est plus équivalent.
import { describe, expect, mock, test } from 'claude-code/testing'

import { ENGINE_ROW, PLUGIN, world } from './world'

const CAUGHT_TOOL = { result: { ok: true }, text: 'réponse du .catch' }
const CAUGHT_NODE = { type: 'Text', props: {}, children: ['dessin du .catch'] }

// --- Le moteur : une forme fausse lance le .catch, dont la réponse tient ------------------------

describe('moteur : une forme fausse passe par le .catch', () => {
  test('tool.call async', async ($, on) => {
    const caught: string[] = []
    on('tool.call', async ($, e) => ({ ...e }) as never).catch(($, e, next) => {
      caught.push(next.error.kind)
      return CAUGHT_TOOL
    })
    expect(await $.tool.call({ tool: 'Bash', tool_use_id: 'toolu_sonde', command: 'ls' })).toEqual(CAUGHT_TOOL)
    expect(caught).toHaveLength(1)
  })

  test('turn.complete async', async ($, on) => {
    mock.clock(on, { now: 1_000 })
    const caught: string[] = []
    on('turn.complete', async ($, e) => ({ ...e }) as never).catch(($, e, next) => {
      caught.push(next.error.kind)
      return { text: 'fin' }
    })
    expect(
      await $.turn.complete({ answer: 'x', durationMs: 0, isAborted: false, turnId: 't1', reason: 'answer' }),
    ).toEqual({ text: 'fin' })
    expect(caught).toHaveLength(1)
  })

  test('ui.render async et synchrone (la forme de CommandOutput /clair)', async ($, on) => {
    const caught: string[] = []
    on('ui.render', { component: 'CommandOutput' }, async ($, e) => ({ ...e }) as never).catch(($, e, next) => {
      caught.push(next.error.kind)
      return CAUGHT_NODE as never
    })
    on('ui.render', { component: 'SessionMode' }, ($, e) => ({ ...e }) as never).catch(($, e, next) => {
      caught.push(next.error.kind)
      return CAUGHT_NODE as never
    })
    for (const ui of [
      await $.ui.mount({
        plugin: PLUGIN,
        surface: 'terminal',
        component: 'CommandOutput',
        props: { command: 'help', args: '', text: 'x', isErrored: false },
      }),
      await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'SessionMode', props: { modes: ['focus'] } }),
    ]) {
      expect(await ui.drawn()).toMatchObject({ type: 'Text', children: ['dessin du .catch'] })
      await ui.unmount()
    }
    expect(caught).toHaveLength(2)
  })
})

// --- Le mod, dans la situation de chaque mutant équivalent ---------------------------------------

function engineOnly(w: ReturnType<typeof world>, component: string) {
  return w.drawn.filter((d) => d.startsWith(`${component}:`))
}

describe('colle : là où le mod laisse passer, la réponse est celle du cœur, atteint une fois', () => {
  // L102C37-next, L116C37-next
  test('tool.call Bash et mcp__ hors bridge', async ($, on) => {
    const w = world(on)
    const bash = { result: { stdout: 'README.md', stderr: '', interrupted: false }, text: 'README.md' }
    const mcp = { result: { content: [] }, text: 'issue 1' }
    w.answers.set('toolu_ls', { result: bash })
    w.answers.set('toolu_gh', { result: mcp })
    expect(await $.tool.call({ tool: 'Bash', tool_use_id: 'toolu_ls', command: 'ls' })).toEqual(bash)
    expect(await $.tool.call({ tool: 'mcp__github__get_issue', tool_use_id: 'toolu_gh', number: 1 })).toEqual(mcp)
    expect(w.coreCalls).toEqual(['toolu_ls', 'toolu_gh'])
    expect(w.stateWrites).toBe(0)
    expect(w.rowWrites).toEqual([])
  })

  // L157C12-next
  test('turn.complete sans appel ouvert', async ($, on) => {
    const w = world(on)
    expect(
      await $.turn.complete({ answer: 'fin', durationMs: 0, isAborted: false, turnId: 't1', reason: 'answer' }),
    ).toEqual({ text: 'fin' })
    expect(w.stateWrites).toBe(0)
  })

  // L238C35-next, L246C36-next
  test('AbovePrompt : sondage, ou rien à montrer', async ($, on) => {
    const w = world(on)
    for (const hasSurvey of [true, false]) {
      const ui = await $.ui.mount({
        plugin: PLUGIN,
        surface: 'terminal',
        component: 'AbovePrompt',
        props: {
          hasSurvey,
          isWorking: true,
          maxRows: 12,
          bodyColumns: 120,
          scroll: { bodyRows: 12, offset: 0 },
          view: {},
        },
      })
      expect(await ui.drawn()).toMatchObject({ type: 'Text', children: [ENGINE_ROW] })
      await ui.unmount()
    }
    expect(engineOnly(w, 'AbovePrompt')).toHaveLength(2)
  })

  // L265C35-next, L283C35-next
  test('ToolUse et ToolGroup sans appel suivi', async ($, on) => {
    const w = world(on)
    const call = { tool: 'Read', input: {}, isRunning: false, isErrored: false, isInterrupted: false }
    const row = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'terminal',
      component: 'ToolUse',
      requestId: 'toolu_r',
      props: { ...call, tool_use_id: 'toolu_r', output: {} },
    })
    expect(await row.drawn()).toMatchObject({ type: 'Text', children: [ENGINE_ROW] })
    await row.unmount()
    const group = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'terminal',
      component: 'ToolGroup',
      props: { calls: [{ ...call, tool_use_id: 'toolu_r' }], isActive: false, isExpanded: false },
    })
    expect(await group.drawn()).toMatchObject({ type: 'Text', children: [ENGINE_ROW] })
    await group.unmount()
    expect(engineOnly(w, 'ToolUse')).toHaveLength(1)
    expect(engineOnly(w, 'ToolGroup')).toHaveLength(1)
  })

  // L298C36-next (hook synchrone), L309C32-next
  test('CommandOutput /clair vide et SessionMode sans problème', async ($, on) => {
    const w = world(on)
    const out = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'terminal',
      component: 'CommandOutput',
      props: { command: 'clair', args: '', text: '', isErrored: false },
    })
    expect(await out.drawn()).toMatchObject({ type: 'Text', children: [ENGINE_ROW] })
    await out.unmount()
    const mode = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'terminal',
      component: 'SessionMode',
      props: { modes: ['focus'] },
    })
    expect(await mode.drawn()).toMatchObject({ type: 'Text', children: ['focus'] })
    await mode.unmount()
    expect(engineOnly(w, 'CommandOutput')).toHaveLength(1)
    expect(engineOnly(w, 'SessionMode')).toHaveLength(1)
  })

  // L227C9-if-false : le hook lève après next ; la réponse déjà obtenue tient, rien ne repasse dessous.
  test('session.append sans notification de fin : une seule ligne au cœur, ni état ni rangée', async ($, on) => {
    const w = world(on)
    const session = mock.session(on)
    const row = {
      message: { type: 'user' as const, content: [{ type: 'text' as const, text: 'bonjour' }] },
      door: 'delivery' as const,
      origin: { kind: 'task-notification' as const },
      uuid: 'row-1',
    }
    await $.session.append(row)
    expect(session.appended()).toHaveLength(1)
    expect(w.stateWrites).toBe(0)
    expect(w.rowWrites).toEqual([])
  })
})
