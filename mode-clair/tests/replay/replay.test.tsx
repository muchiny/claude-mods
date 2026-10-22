// Rejeu sous le moteur : chaque scénario (réel anonymisé, ou synthétique) passe dans le vrai mod
// (register monté par `claude plugin test`), sous le monde de tests/engine/world.ts ; l'état final,
// ramené au vocabulaire de l'oracle par `project`, doit égaler la vérité que l'oracle indépendant
// tire des seuls événements (`truthOf`, REFERENCE.md). Un désaccord tranché en faveur du mod porte son
// `oracleNote` dans le scénario synthétique (synthetic.ts) ; aucun scénario réel n'en a eu besoin.

import type { On, ToolCallInput } from 'claude-code'
import type { TestBody } from 'claude-code/testing'
import { describe, expect, test } from 'claude-code/testing'

import { lastState, world, writeFile } from '../engine/world'
import { type AnyEvent, type AnyScenario, project, truthOf } from './oracle'
import { SCENARIOS } from './scenarios.generated'
import { RULINGS, SYNTHETIC } from './synthetic'

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
  // Un appel d'outil rejeté (le cœur ou un hook qui lève) est noté : aucun scénario n'en attend.
  const rejections: string[] = []
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
        pending.push(
          $.tool.call(input).catch((err: unknown) => {
            rejections.push(`${e.toolUseId}: ${err instanceof Error ? err.message : String(err)}`)
          }),
        )
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
  return { w, rejections }
}

const ALL: readonly AnyScenario[] = [...SCENARIOS, ...SYNTHETIC, ...RULINGS]

describe('rejeu des sessions réelles et synthétiques contre l’oracle', () => {
  for (const s of ALL)
    test(s.id, async ($, on) => {
      const { w, rejections } = await play($, on, s)
      expect(rejections).toEqual([])
      expect(project(lastState(w))).toEqual(truthOf(s))
    })
})

// Review Focus 5 : ce que `project` doit montrer, indépendamment de l'oracle.
describe('Review Focus 5', () => {
  const byId = (id: string) => SYNTHETIC.find((s) => s.id === id) as AnyScenario

  // « Résultat sans appel connu » : le format de rejeu ne peut pas livrer un résultat de tool.call sans son
  // début (le hook enveloppe tout l'appel) ; il est approché par ce qui vise un id jamais vu :
  // classic.PermissionDenied, classic.ElicitationResult sans formulaire en attente, turn.complete.
  test('résultat sans appel connu : aucun appel', async ($, on) => {
    const { w } = await play($, on, byId('synth-resultat-sans-appel'))
    expect(project(lastState(w)).calls).toEqual([])
  })

  test('tool_use_id dupliqué : un seul appel', async ($, on) => {
    const { w } = await play($, on, byId('synth-id-duplique'))
    expect(project(lastState(w)).calls.filter((c) => c.toolUseId === 'toolu_r1007')).toHaveLength(1)
  })

  test('reprise après /clear : rien d’affirmé sur un appel jamais vu', async ($, on) => {
    const { w } = await play($, on, byId('synth-reprise-apres-clear'))
    expect(project(lastState(w)).calls.map((c) => c.toolUseId)).toEqual(['toolu_r1008'])
  })
})
