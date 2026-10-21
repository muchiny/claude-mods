import type { ToolCallResult } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import { reduceScenarios, sizeOf, traitsOf, typeOf } from '../../dev/replay/reduce'
import type { Scenario } from '../../mode-clair/tests/replay/scenarios.generated'

// Scénarios fabriqués (forme réelle, contenu fictif).
const call = (tool: string, input: unknown, text = 'ok', isError = false) =>
  ({
    t: 0,
    kind: 'tool.call',
    tool,
    toolUseId: 'toolu_r0001',
    input,
    result: { isError, result: null, text } as ToolCallResult,
    afterMs: 1,
  }) as const
const scenario = (id: string, events: Scenario['events'], pad = 0): Scenario => ({
  id,
  source: 'replay',
  events,
  files: pad === 0 ? {} : { 'docs/superpowers/plans/x.md': 'x'.repeat(pad) },
})
const bash = (command: string, text = 'ok', isError = false) => call('Bash', { command }, text, isError)

describe('replay:reduce : traits de signature', () => {
  test('le type vient du préfixe de l’identifiant', () => {
    expect(typeOf(scenario('bridge-cli-1', []))).toBe('bridge-cli')
    expect(typeOf(scenario('plan-write-1', []))).toBe('plan-write')
    expect(typeOf(scenario('inconnu-1', []))).toBe('autre')
  })

  test('multi, erreur, tronqué et incertain sont relevés dans les événements', () => {
    const multi = scenario('bridge-mcp-1', [call('mcp__ssh-bridge__ssh_exec_multi', { hosts: ['a'] })])
    expect(traitsOf(multi)).toStrictEqual(['bridge-mcp', 'multi'])
    const error = scenario('bridge-cli-2', [bash('bridge-mcp tool x', 'boom', true)])
    expect(traitsOf(error)).toStrictEqual(['bridge-cli', 'erreur'])
    const cut = scenario('bridge-cli-3', [bash('bridge-mcp tool x', '--- [truncated: 10 lines]')])
    expect(traitsOf(cut)).toStrictEqual(['bridge-cli', 'tronque'])
    const output = scenario('bridge-mcp-2', [call('mcp__ssh-bridge__ssh_journal_query', {}, 'x output_id="abc" y')])
    expect(traitsOf(output)).toStrictEqual(['bridge-mcp', 'tronque'])
    const stopped = scenario('bridge-mcp-3', [call('mcp__ssh-bridge__ssh_tail', {}, '[output stopped at the limit]')])
    expect(traitsOf(stopped)).toStrictEqual(['bridge-mcp', 'tronque'])
    const chain = scenario('bridge-cli-4', [bash('bridge-mcp tool x && echo fin')])
    expect(traitsOf(chain)).toStrictEqual(['bridge-cli', 'incertain'])
    const loop = scenario('bridge-cli-5', [bash('for h in a b; do bridge-mcp tool x host=$h; done')])
    expect(traitsOf(loop)).toStrictEqual(['bridge-cli', 'incertain'])
    const plain = scenario('bridge-cli-6', [bash('bridge-mcp tool x host=a')])
    expect(traitsOf(plain)).toStrictEqual(['bridge-cli'])
    // Une chaîne qui n'est pas du bridge n'est pas « incertain ».
    expect(traitsOf(scenario('agent-1', [bash('ls && pwd')]))).toStrictEqual(['agent'])
    expect(traitsOf(scenario('agent-2', [{ t: 0, kind: 'turn.complete' }]))).toStrictEqual(['agent'])
  })
})

describe('replay:reduce : réduction', () => {
  const all = [
    scenario('bridge-cli-a', [bash('bridge-mcp tool x host=a')], 400),
    scenario('bridge-cli-b', [bash('bridge-mcp tool x host=a')]),
    scenario('bridge-cli-c', [bash('bridge-mcp tool x host=a')], 800),
    scenario('bridge-cli-d', [bash('bridge-mcp tool x && true')], 5_000),
    scenario('bridge-mcp-a', [call('mcp__ssh-bridge__ssh_exec_multi', { hosts: [] })], 300),
    scenario('workflow-a', [call('Workflow', {})], 200),
    scenario('plan-write-a', [call('Write', {})], 100_000),
    scenario('plan-write-b', [call('Write', {})], 600),
    scenario('notification-a', [{ t: 0, kind: 'session.append', text: 'n' }]),
  ]

  test('garde un scénario de chaque type et de chaque trait, le plus court, même si le budget est serré', () => {
    const must = reduceScenarios(all, 12_000)
    const ids = must.map((s) => s.id)
    expect(ids).toContain('bridge-cli-d') // seul « incertain »
    expect(ids).toContain('bridge-mcp-a') // seul « multi »
    expect(ids).toContain('plan-write-b') // le plus court des deux
    expect(ids).not.toContain('plan-write-a')
    for (const t of ['bridge-cli', 'bridge-mcp', 'workflow', 'plan-write', 'notification'])
      expect(ids.some((id) => id.startsWith(`${t}-`))).toBe(true)
    expect(must.reduce((n, s) => n + sizeOf(s), 0)).toBeLessThanOrEqual(12_000)
  })

  test('le résultat est trié par identifiant et ne contient que des scénarios entiers de l’entrée', () => {
    const kept = reduceScenarios(all, 20_000)
    expect(kept.map((s) => s.id)).toStrictEqual([...kept.map((s) => s.id)].sort())
    for (const s of kept) expect(all).toContain(s)
  })

  test('les tours de remplissage préfèrent les plus courts, un type à la fois', () => {
    const exact = reduceScenarios(all, 20_000).map((s) => s.id)
    // Le budget laisse entrer bridge-cli-a (400) et -c (800), pas les 100 000 de plan-write-a.
    expect(exact).toContain('bridge-cli-b')
    expect(exact).toContain('bridge-cli-a')
    expect(exact).toContain('bridge-cli-c')
    expect(exact).not.toContain('plan-write-a')
    const generous = reduceScenarios(all, 1_000_000).map((s) => s.id)
    expect(generous).toHaveLength(all.length)
  })

  test('un budget trop petit pour les scénarios obligatoires est une erreur, rien n’est tronqué', () => {
    expect(() => reduceScenarios(all, 1_000)).toThrow('obligatoires')
  })

  test('une entrée vide donne une sortie vide', () => {
    expect(reduceScenarios([], 100)).toStrictEqual([])
  })
})
