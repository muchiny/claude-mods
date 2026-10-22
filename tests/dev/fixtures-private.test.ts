// Garde locale de la fixture de rejeu committée (audit de confidentialité, M1) : les deux barrières de
// l'anonymiseur (assertClean avec la liste noire privée, assertKnownForms) sur CHAQUE scénario de
// SCENARIOS. Sans liste noire : échec, sauf sous GitHub Actions ou avec SKIP_PRIVATE_FIXTURES=1 (la raison est
// affichée) ; assertKnownForms tourne toujours. Aucun message ne recopie de contenu.
import { describe, expect, test } from 'claude-code/testing'
import { assertFixture } from '../../dev/replay/anonymize'
import { TYPES, typeOf } from '../../dev/replay/reduce'
import { SCENARIOS, type Scenario } from '../../mode-clair/tests/replay/scenarios.generated'
// @ts-expect-error module .mjs sans déclaration de types
import { denylistUnder, privateDenylist } from './private-denylist.mjs'

const DENY = ['machine-reelle-1']
const one = (id: string, text: string, files: Record<string, string> = {}): Scenario => ({
  id,
  source: 'replay',
  files,
  events: [
    {
      t: 0,
      kind: 'tool.call',
      tool: 'Bash',
      toolUseId: 'toolu_r0001',
      input: { command: 'bridge-mcp exec host-a lorem' },
      result: { result: 'ok', text },
      afterMs: 0,
    },
  ],
})

describe('garde des fixtures : fixture contaminée synthétique', () => {
  test('propre : passe', () => {
    expect(() => assertFixture([one('essai-0200', 'Exit code 0\nlorem ipsum')], DENY)).not.toThrow()
  })
  test('entrée de la liste noire, chemin personnel, mot inconnu, horodatage réel : refusés sans recopie', () => {
    const bad = [
      one('essai-0201', 'connexion à Machine_Reelle 1'),
      one('essai-0202', 'lorem', { '/home/quelquun/x.md': '' }),
      one('essai-0203', 'Zorglub'),
      one('essai-0204', '2026-10-21T10:00:00.123Z  INFO lorem'),
    ]
    for (const s of bad) {
      const clean = one('essai-0299', 'lorem')
      expect(() => assertFixture([clean, s], DENY)).toThrow(s.id)
      try {
        assertFixture([s], DENY)
      } catch (e) {
        for (const leak of ['Machine', 'quelquun', 'Zorglub', '2026']) expect(String(e)).not.toContain(leak)
      }
    }
  })
})

type Denylist = { entries: string[] } | { skip: boolean; reason: string }

describe('garde des fixtures : quand la liste noire manque (L-3)', () => {
  const under = (o: { env: Record<string, string>; content: string | null; mode?: number }) =>
    denylistUnder(o) as Denylist
  test('hors GitHub Actions, absente ou illisible : échec, pas un saut ; CI exporté à la main n’y change rien', () => {
    expect(under({ env: {}, content: null })).toMatchObject({ skip: false })
    expect(under({ env: { CI: 'true' }, content: null })).toMatchObject({ skip: false })
    expect(under({ env: {}, content: '# rien\n\n' })).toMatchObject({ skip: false })
  })
  test('GitHub Actions ou SKIP_PRIVATE_FIXTURES=1 : sauté, avec la raison', () => {
    expect(under({ env: { GITHUB_ACTIONS: 'true' }, content: null })).toMatchObject({ skip: true })
    expect(under({ env: { SKIP_PRIVATE_FIXTURES: '1' }, content: null })).toMatchObject({ skip: true })
  })
  test('lisible : ses entrées', () => {
    expect(under({ env: {}, content: 'a\n# b\nc\n' })).toEqual({ entries: ['a', 'c'] })
  })
})

describe('garde des fixtures : fixture committée', () => {
  test('assertKnownForms et les fuites génériques sur chaque scénario, sans liste noire (aussi en CI)', () => {
    expect(() => assertFixture(SCENARIOS, [])).not.toThrow()
  })
  test('au moins 50 scénarios et chacun des types attendus (une fixture vide échoue)', () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(50)
    expect(new Set(SCENARIOS.map(typeOf))).toEqual(new Set(TYPES))
  })

  const deny = privateDenylist() as Denylist
  if ('entries' in deny)
    test(`les ${SCENARIOS.length} scénarios passent assertClean (liste noire privée) et assertKnownForms`, () => {
      expect(() => assertFixture(SCENARIOS, deny.entries)).not.toThrow()
    })
  else if (deny.skip) {
    console.log(`garde des fixtures (liste noire) sautée : ${deny.reason}`)
    test(`liste noire privée : sauté (${deny.reason})`, () => {})
  } else
    test('liste noire privée lisible (sinon SKIP_PRIVATE_FIXTURES=1)', () => {
      throw new Error(
        `garde des fixtures : ${deny.reason} (~/.config/claude-mods/denylist.txt ; SKIP_PRIVATE_FIXTURES=1 pour sauter)`,
      )
    })
})
