import { describe, expect, test } from 'claude-code/testing'
import { stripControls } from '../../hooks/bridge'
import { cellWidth } from '../../hooks/cells'
import { callLine, cardLines, pipeline } from '../../hooks/view'
import type { BridgeCall, ClairState, Line } from '../../types'

const call = (patch: Partial<BridgeCall> = {}): BridgeCall => ({
  id: 'toolu_a#0',
  toolUseId: 'toolu_a',
  via: 'mcp',
  tool: 'ssh_disk_usage',
  host: 'raspberry',
  nature: 'lecture',
  state: 'fait',
  truncated: false,
  accord: 'aucun',
  startedAt: 1_000,
  endedAt: 1_400,
  ...patch,
})
const stateOf = (calls: BridgeCall[], patch: Partial<ClairState> = {}): ClairState => {
  const hostOrder: string[] = []
  for (const c of calls) if (c.host !== null && !hostOrder.includes(c.host)) hostOrder.push(c.host)
  return { calls, hostOrder, seenAt: 0, waiting: null, superpowers: null, workflows: [], sessions: {}, ...patch }
}
const text = (line: Line) => line.map((p) => p.text).join('')
const _CTX = { now: 10_000, columns: 200, isWorking: true }

// Points de code d'usurpation d'affichage (revue finale L9) : un par catégorie.
const SPOOFS: readonly [string, string][] = [
  ['embedding/override bidi', '\u202a\u202b\u202c\u202d\u202e'],
  ['isolats bidi', '\u2066\u2067\u2068\u2069'],
  ['largeur nulle et marques directionnelles', '\u200b\u200c\u200d\u200e\u200f'],
  ['marque arabe', '\u061c'],
  ['séparateurs de ligne et de paragraphe', '\u2028\u2029'],
  ['autres Cf', '\u00ad\u2060\ufeff\u180e'],
]

describe('stripControls : séquences d’usurpation d’affichage (L9)', () => {
  for (const [name, chars] of SPOOFS) {
    test(`${name} sont retirés`, () => {
      expect(stripControls(`a${chars}b`)).toBe('ab')
    })
  }
  test('un texte ordinaire, accentué ou CJK passe tel quel, \\n est gardé', () => {
    expect(stripControls('é 机 \u{1f680}\nx')).toBe('é 机 \u{1f680}\nx')
  })
})

describe('noms affichés : séquences d’usurpation retirées (L9)', () => {
  for (const [name, chars] of SPOOFS) {
    test(`hôte, outil et raison : ${name}`, () => {
      const c = call({ host: `a${chars}b`, tool: `t${chars}u`, state: 'injoignable', reason: `r${chars}s` })
      const s = stateOf([c])
      const drawn = [
        text(callLine(c, s, 200)),
        text(pipeline(c, s)),
        ...cardLines(s, '', 20_000).map(text),
        ...cardLines(s, ' ab ', 20_000).map(text),
      ].join('\n')
      expect(drawn).toContain('ab')
      expect(drawn).not.toMatch(/[\p{Cf}\p{Zl}\p{Zp}]/u)
    })
  }
  test('emoji ZWJ : décomposé mais sans débordement de largeur', () => {
    const c = call({ host: '\u{1f469}\u200d\u{1f4bb}' })
    const t = text(callLine(c, stateOf([c]), 200))
    expect(t).toContain('\u{1f469}\u{1f4bb}')
    expect(cellWidth(t)).toBeLessThanOrEqual(200)
  })
})

// Revue finale (L-6) : ignorables par défaut, demi-codets isolés, fillers Hangul, CGJ, voyelles khmères
// inhérentes ; et les suites de marques combinantes (« zalgo ») plafonnées à 2 par caractère de base.
// Décision : les sélecteurs de variante (U+FE00-FE0F, U+E0100-E01EF) sont retirés partout d'un texte venu
// d'ailleurs ; la largeur vient du caractère de base (« ⚠️ » devient « ⚠ », 1 cellule), jamais d'une suite.
const IGNORABLES: readonly [string, string][] = [
  ['sélecteurs de variante', '\ufe0f\ufe0e\ufe00\u{e0100}'],
  ['demi-codets isolés', '\udfff\ud800'],
  ['fillers Hangul', '\u115f\u1160\u3164\uffa0'],
  ['CGJ', '\u034f'],
  ['voyelles khmères inhérentes', '\u17b4\u17b5'],
  ['autres ignorables (Mongolian FVS, U+2065)', '\u180b\u2065'],
]

describe('stripControls : ignorables et marques combinantes (L-6)', () => {
  for (const [name, chars] of IGNORABLES) {
    test(`${name} sont retirés`, () => {
      expect(stripControls(`a${chars}b`)).toBe('ab')
    })
  }
  test('marques combinantes : 2 au plus par caractère de base', () => {
    expect(stripControls(`e${'\u0301'.repeat(30)}x\u0300y`)).toBe('e\u0301\u0301x\u0300y')
    expect(stripControls('\u0301\u0301\u0301')).toBe('\u0301\u0301')
  })
  test('« ⚠️ » × 10 dans un nom : dessiné sans sélecteur, largeur de base', () => {
    const c = call({ host: '\u26a0\ufe0f'.repeat(10) })
    const t = text(callLine(c, stateOf([c]), 200))
    expect(t).toContain('\u26a0'.repeat(10))
    expect(t).not.toContain('\ufe0f')
  })
})
