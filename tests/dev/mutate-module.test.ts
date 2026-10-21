import { describe, expect, test } from 'claude-code/testing'
// @ts-expect-error module .mjs sans déclaration de types
import { configFor, DEFAULT_PROPS_RUNS, testsFor } from '../../dev/mutate-module.mjs'
// @ts-expect-error module .mjs sans déclaration de types
import { runModule } from './glue-cli.mjs'

describe('testsFor : tests qui atteignent un module par leurs imports', () => {
  test('sur le dépôt : cells est atteint par width, view par golden, superpowers par lui seul', () => {
    expect(testsFor('mode-clair/hooks/cells.ts')).toContain('tests/width/cells.test.ts')
    expect(testsFor('mode-clair/hooks/view.ts')).toContain('tests/golden/render.test.ts')
    expect(testsFor('mode-clair/hooks/superpowers.ts')).toEqual(['mode-clair/tests/pure/superpowers.test.ts'])
    expect(testsFor('mode-clair/hooks/colors.ts')).not.toContain('tests/width/cells.test.ts')
    // le test exhaustif de largeur ne ralentit que les mutants de cells.ts
    for (const m of ['bridge', 'state', 'view', 'workflow', 'colors', 'fr', 'superpowers'])
      expect(testsFor(`mode-clair/hooks/${m}.ts`)).not.toContain('tests/width/cells.test.ts')
  })
})

describe('configFor', () => {
  test('mutate, commande (graine 42, PROPS_RUNS réduit) et rapport propres au module', () => {
    const base = { testRunner: 'command', thresholds: { break: 100 }, reporters: ['html'] }
    const c = configFor(base, 'fr.ts', ['tests/a.test.ts', 'tests/b.test.ts'])
    expect(c.mutate).toEqual(['mode-clair/hooks/fr.ts'])
    expect(c.commandRunner.command).toBe(
      `PROPS_RUNS=${DEFAULT_PROPS_RUNS} PROPS_SEED=42 bun test --timeout 120000 ./tests/a.test.ts ./tests/b.test.ts`,
    )
    expect(c.jsonReporter.fileName).toBe('reports/mutation-pure/fr.ts.json')
    expect(c.thresholds).toEqual({ break: 100 })
  })
})

describe('mutate-module en ligne de commande', () => {
  test('module inconnu ou option invalide : code 2 ; --list ne lance rien', () => {
    expect(runModule(['nexiste.ts']).status).toBe(2)
    expect(runModule(['fr.ts', '--concurrency', '0']).status).toBe(2)
    expect(runModule(['fr.ts', '--runs', 'x']).status).toBe(2)
    const list = runModule(['fr.ts', '--list'])
    expect(list.status).toBe(0)
    expect(list.stdout).toContain('mode-clair/tests/pure/fr.test.ts')
  })
})
