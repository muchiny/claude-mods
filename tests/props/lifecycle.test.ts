// Propriétés du cycle de vie d'un appel (spec §5.1, « Cycle de vie d'un appel » et « Classement »).
import { describe, expect, test } from 'claude-code/testing'
import * as fc from 'fast-check'
import { BRIDGE_TEXTS, classify, type ParsedCall, type RunResult } from '../../mode-clair/hooks/bridge'
import { finishCalls, interruptOpen, MAX_CALLS, running, STATE_TABLE, startCalls } from '../../mode-clair/hooks/state'
import { TOOLS } from '../../mode-clair/hooks/tools.generated'
import type { CallState, ClairState } from '../../mode-clair/types'
import { arbBulk, arbEvents, arbParsed, arbState, arbText } from './arbitraries'
import { final, targets, trace } from './model'
import { check } from './settings'

describe('propriétés : cycle de vie', () => {
  test('aucun appel n’est fait sans résultat : un appel terminé a été visé par une fin, un refus, une fin de tour ou un retrait', () => {
    check(
      fc.property(arbEvents(), (evs) => {
        const states = trace(evs)
        evs.forEach((ev, i) => {
          const before = states[i]?.calls ?? []
          for (const c of states[i + 1]?.calls ?? []) {
            expect(c.state === 'en-cours' || c.endedAt !== undefined).toBe(true)
            if (c.endedAt !== undefined) expect(c.endedAt).toBeGreaterThanOrEqual(c.startedAt)
            const was = before.find((b) => b.id === c.id)
            // Un appel qui vient de se terminer l'a été par un événement qui le visait.
            if (was?.state === 'en-cours' && c.state !== 'en-cours') expect(targets(ev, c)).toBe(true)
            // Un appel n'est jamais ressuscité en cours.
            if (was !== undefined && was.state !== 'en-cours') expect(c.state).not.toBe('en-cours')
          }
        })
      }),
    )
  })

  test('jamais ✓ sur un échec : classify d’un résultat en erreur ne donne pas un état à signe ✓', () => {
    const arbLine = fc.oneof(
      arbText(),
      fc.constantFrom(
        'Error: boom',
        '[exit:0]',
        '[exit:3]',
        '{"content":[{"text":"[exit:0]"}]}',
        '{"results":[{"host":"host-a","exit_code":0}]}',
        '{"exit_code":0}',
        'Exit code: 0',
      ),
    )
    // En-tête de Bash (`Exit code N`, y compris 0) devant le corps : c'est la forme que lit la CLI.
    const arbHeader = fc.oneof(
      fc.constant([] as string[]),
      fc.integer({ min: 0, max: 7 }).map((n) => [`Exit code ${n}`]),
    )
    const arbRun = fc.record({
      isError: fc.constant(true),
      text: fc.tuple(arbHeader, fc.array(arbLine, { maxLength: 4 })).map(([h, l]) => [...h, ...l].join('\n')),
      interrupted: fc.constantFrom(false, false, false, true),
      refusedByClaude: fc.constantFrom(false, false, false, true),
    })
    check(
      fc.property(arbParsed(), arbRun, (p, r) => {
        const o = classify(p, r, TOOLS)
        expect(STATE_TABLE[o.state].sign).not.toBe('✓')
      }),
    )
  })

  test('fin de tour : après interruptOpen, aucun appel de cette boucle n’est en cours, les autres ne bougent pas', () => {
    check(
      fc.property(arbState(), fc.constantFrom(undefined, 'ag-1', 'ag-2'), (s, agentId) => {
        const after = interruptOpen(s, agentId, 10_000)
        expect(running(after).filter((c) => c.agentId === agentId)).toEqual([])
        s.calls.forEach((c, i) => {
          if (c.state !== 'en-cours' || c.agentId !== agentId) expect(after.calls[i]).toBe(c)
        })
      }),
    )
  })

  test('ordre indépendant : deux appels finis dans l’un ou l’autre ordre donnent les mêmes états finaux', () => {
    const arbFinal = fc.constantFrom<CallState>('fait', 'echec', 'code', 'incertain', 'injoignable', 'refuse-claude')
    check(
      fc.property(arbEvents(), arbParsed(), arbParsed(), arbFinal, arbFinal, (prefix, pa, pb, sa, sb) => {
        const base = final([...prefix, { kind: 'start', toolUseId: 'fresh_A', parsed: [pa] }])
        const both = startCalls(base, 'fresh_B', undefined, [pb], 5_000)
        const doneA = (s: ClairState) => finishCalls(s, 'fresh_A', [{ state: sa, truncated: false }], 9_000)
        const doneB = (s: ClairState) => finishCalls(s, 'fresh_B', [{ state: sb, truncated: false }], 9_000)
        // Même heure de fin pour les deux : seul l'ordre diffère.
        expect(doneB(doneA(both))).toStrictEqual(doneA(doneB(both)))
      }),
    )
  })

  test('plafond : au plus MAX_CALLS appels plus les appels en cours, et aucun appel en cours n’est évincé', () => {
    check(
      fc.property(arbBulk(), (evs) => {
        const states = trace(evs)
        // Une seule assertion par suite (les suites font plusieurs centaines d'événements) : le premier écart.
        let first: string | null = null
        evs.forEach((ev, i) => {
          const before = states[i]
          const after = states[i + 1]
          if (first !== null || before === undefined || after === undefined) return
          const open = new Map(after.calls.map((c) => [c.id, c.state]))
          if (after.calls.length > MAX_CALLS + running(after).length) first = `événement ${i} : plafond dépassé`
          for (const c of running(before)) {
            if (!targets(ev, c) && open.get(c.id) !== 'en-cours') first = `événement ${i} : ${c.id} évincé ou fermé`
          }
        })
        expect(first).toBeNull()
      }),
    )
  })

  test('déterminisme : la même suite d’événements, deux fois, donne le même état', () => {
    check(
      fc.property(arbEvents(), (evs) => {
        expect(final(evs)).toStrictEqual(final(evs))
      }),
    )
  })

  // Spec §5.1 (classement) : les motifs d’erreur ne sont lus que sur un appel EN ÉCHEC ; la règle 3 dit
  // « isError + table des textes ; sans correspondance → échec », la règle 5 « sinon → fait ». Un texte
  // sans code de sortie ni motif connu donne donc `fait` (CLI sortie 0 ou MCP sans erreur, rien ne prouve
  // le contraire) ou `incertain` (segment qui ne possède pas le code), et `echec` seulement quand
  // isError le prouve : ce ✗ est établi par l’événement, pas deviné.
  test('sortie illisible : sans code ni motif connu, l’état est incertain ou fait (echec seulement si isError le prouve)', () => {
    const known = (text: string) =>
      text
        .split('\n')
        .some(
          (l) => /exit|^\s*\{/i.test(l) || BRIDGE_TEXTS.some((row) => row.re.test(l.trim().replace(/^Error: /, ''))),
        )
    const arbPlain = fc.array(fc.string({ unit: 'grapheme', maxLength: 40 }), { maxLength: 4 }).map((l) => l.join('\n'))
    check(
      fc.property(
        arbParsed(),
        arbPlain.filter((t) => !known(t)),
        fc.boolean(),
        (p: ParsedCall, text, isError) => {
          const r: RunResult = { isError, text, interrupted: false, refusedByClaude: false }
          const o = classify(p, r, TOOLS)
          if (isError) expect(['incertain', 'echec']).toContain(o.state)
          else expect(['incertain', 'fait']).toContain(o.state)
        },
      ),
    )
  })
})
