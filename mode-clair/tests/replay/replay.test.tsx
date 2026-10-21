// Rejeu sous le moteur : chaque scénario (réel anonymisé, ou synthétique) passe dans le vrai mod
// (register monté par `claude plugin test`), sous le monde de tests/engine/world.ts ; l'état final,
// ramené au vocabulaire de l'oracle par `project`, doit égaler la vérité que l'oracle indépendant
// tire des seuls événements (`truthOf`, REFERENCE.md). Un désaccord : voir oracle-notes.ts.

import type { On, ToolCallInput } from 'claude-code'
import type { TestBody } from 'claude-code/testing'
import { describe, expect, test } from 'claude-code/testing'

import { lastState, world, writeFile } from '../engine/world'
import { type AnyEvent, type AnyScenario, project, truthOf } from './oracle'
import { SCENARIOS } from './scenarios.generated'
import { QUESTIONS, SYNTHETIC } from './synthetic'

type Dollar = Parameters<TestBody>[0]

const CWD = '/home/user/projet'

/** Fin (horloge) d'un événement : celle de son résultat pour un appel d'outil. */
const endOf = (e: AnyEvent): number => e.t + (e.kind === 'tool.call' ? e.afterMs : 0)

/**
 * Joue `s` sous le monde : fichiers écrits d'abord (datés de l'heure de départ), puis chaque événement
 * à son heure (horloge avancée jusque-là), les appels d'outils lancés sans attendre leur fin (le cœur
 * répond par tool_use_id après `afterMs`), enfin l'horloge jusqu'à la dernière fin et chaque appel attendu.
 */
async function play($: Dollar, on: On, s: AnyScenario) {
  const w = world(on)
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  for (const [path, text] of Object.entries(s.files)) writeFile(w, path, text)
  await $.session.start({ cwd: CWD, surface: null, isInteractive: true })
  const start = w.clock.now() - (s.events[0]?.t ?? 0)
  const pending: Promise<unknown>[] = []
  const until = async (at: number) => {
    const now = w.clock.now()
    if (at > now) await w.clock.advance(at - now)
  }
  for (const e of s.events) {
    await until(start + e.t)
    switch (e.kind) {
      case 'tool.call': {
        w.answers.set(e.toolUseId, { result: e.result, afterMs: e.afterMs })
        const input = {
          ...(e.input as object),
          tool: e.tool,
          tool_use_id: e.toolUseId,
          ...(e.agentId === undefined ? {} : { agentId: e.agentId }),
        } as ToolCallInput
        pending.push($.tool.call(input).catch(() => undefined))
        break
      }
      case 'turn.complete':
        await $.turn.complete({
          answer: '',
          durationMs: 0,
          isAborted: false,
          turnId: `t${e.t}`,
          reason: 'answer',
          ...(e.agentId === undefined ? {} : { agentId: e.agentId }),
        } as never)
        break
      case 'session.append':
        await $.session.append({
          message: { type: 'user', content: [{ type: 'text', text: e.text }] },
          door: 'delivery',
          origin: { kind: 'task-notification' },
          uuid: `row-${e.t}`,
        } as never)
        break
      case 'permission.denied':
        await $.classic.PermissionDenied({
          tool_name: e.tool,
          tool_input: e.input,
          tool_use_id: e.toolUseId,
          reason: 'classifier',
        } as never)
        break
      case 'elicitation':
        await $.classic.Elicitation({ mcp_server_name: e.server, message: e.message, mode: 'form' } as never)
        break
      case 'elicitation.result':
        await $.classic.ElicitationResult({
          mcp_server_name: e.server,
          action: e.action,
          ...(e.confirm === undefined ? {} : { content: { confirm: e.confirm } }),
        } as never)
        break
      case 'clear':
        // `/clear` : la conversation finit (session.end), le processus continue ; la reprise relit l'état.
        await $.session.end({ reason: 'clear', sessionId: 's-avant', resume: { id: 's-avant' } } as never)
        await $.session.start({ cwd: CWD, surface: null, isInteractive: true })
        break
    }
    await w.clock.settle()
  }
  await until(start + Math.max(0, ...s.events.map(endOf)))
  await Promise.all(pending)
  await w.clock.settle()
  return w
}

const ALL: readonly AnyScenario[] = [...SCENARIOS, ...SYNTHETIC]

describe('rejeu des sessions réelles et synthétiques contre l’oracle', () => {
  for (const s of ALL)
    test(s.id, async ($, on) => {
      const w = await play($, on, s)
      expect(project(lastState(w))).toEqual(truthOf(s))
    })
})

// Review Focus 5 : ce que `project` doit montrer, indépendamment de l'oracle.
describe('Review Focus 5', () => {
  const byId = (id: string) => SYNTHETIC.find((s) => s.id === id) as AnyScenario

  test('résultat sans appel connu : aucun appel', async ($, on) => {
    const w = await play($, on, byId('synth-resultat-sans-appel'))
    expect(project(lastState(w)).calls).toEqual([])
  })

  test('tool_use_id dupliqué : un seul appel', async ($, on) => {
    const w = await play($, on, byId('synth-id-duplique'))
    expect(project(lastState(w)).calls.filter((c) => c.toolUseId === 'toolu_r1007')).toHaveLength(1)
  })

  test('reprise après /clear : rien d’affirmé sur un appel jamais vu', async ($, on) => {
    const w = await play($, on, byId('synth-reprise-apres-clear'))
    expect(project(lastState(w)).calls.map((c) => c.toolUseId)).toEqual(['toolu_r1008'])
  })
})

// Questions ouvertes (synthetic.ts) : l'appel visé rend l'une des réponses candidates, le reste égale l'oracle.
describe('questions ouvertes', () => {
  for (const q of QUESTIONS)
    test(`${q.id} ${q.scenario.id}`, async ($, on) => {
      const w = await play($, on, q.scenario)
      const got = project(lastState(w))
      const want = truthOf(q.scenario)
      expect(got.calls.map((c) => [c.toolUseId, c.host])).toEqual(want.calls.map((c) => [c.toolUseId, c.host]))
      for (const c of got.calls)
        expect(q.candidates[c.toolUseId] ?? [want.calls.find((x) => x.toolUseId === c.toolUseId)?.outcome]).toContain(
          c.outcome,
        )
    })
})
