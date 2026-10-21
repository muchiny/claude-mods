// Garde locale de la fixture de rejeu committée (audit de confidentialité, M1) : les deux barrières de
// l'anonymiseur (assertClean avec la liste noire privée, assertKnownForms) sur CHAQUE scénario de
// SCENARIOS. Sans liste noire (CI, autre machine) : ignoré. Aucun message ne recopie de contenu.
import { describe, expect, test } from 'claude-code/testing'
import { assertFixture } from '../../dev/replay/anonymize'
import { SCENARIOS, type Scenario } from '../../mode-clair/tests/replay/scenarios.generated'
// @ts-expect-error module .mjs sans déclaration de types
import { privateDenylist } from './private-denylist.mjs'

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

const deny = privateDenylist() as string[] | null
describe('garde des fixtures : fixture committée et liste noire privée', () => {
  if (deny === null) test('ignoré (CI ou ~/.config/claude-mods/denylist.txt absente)', () => {})
  else
    test(`les ${SCENARIOS.length} scénarios passent assertClean et assertKnownForms`, () => {
      expect(() => assertFixture(SCENARIOS, deny)).not.toThrow()
    })
})
