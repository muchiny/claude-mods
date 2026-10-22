// Largeur exhaustive : chaque point de code seul, et suivi de U+FE0F, comparés à string-width (la référence
// du dépôt, tests/golden). Aucun écart sur un point de code seul ; les étiquettes E0000 à E0FFF sont ignorables.
import { describe, expect, test } from 'claude-code/testing'
import stringWidth from 'string-width'
import { cellWidth } from '../../mode-clair/hooks/cells'

const LAST = 0x40000
// Intérieur des grands blocs uniformes (CJK, hangul, plans 2 et 3) : seuls leurs bords comptent pour la table.
const SKIP: readonly (readonly [number, number])[] = [
  [0x4e01, 0x9ffe],
  [0xac02, 0xd7a1],
  [0x20002, 0x2fffb],
  [0x30002, 0x3fffb],
]
// Écarts admis, par excès seulement : xterm unicode11 / wcwidth les rendent sur 2 cellules, string-width sur 0 ou 1.
const WIDER_THAN_STRING_WIDTH = [0x115f, 0x3164, 0x1f93b, 0x1f946]
const skipped = (cp: number): boolean => SKIP.some(([lo, hi]) => cp >= lo && cp <= hi)

describe('cellWidth : exhaustif', () => {
  test('chaque point de code seul vaut string-width', { timeoutMs: 30_000 }, () => {
    const diffs: number[] = []
    for (let cp = 0; cp <= LAST; cp += 1) {
      if ((cp >= 0xd800 && cp <= 0xdfff) || skipped(cp) || WIDER_THAN_STRING_WIDTH.includes(cp)) continue
      const ch = String.fromCodePoint(cp)
      if (cellWidth(ch) !== stringWidth(ch)) diffs.push(cp)
    }
    expect(diffs).toEqual([])
  })

  test('les quatre écarts admis valent 2 cellules (maximum de string-width et de xterm unicode11)', () => {
    for (const cp of WIDER_THAN_STRING_WIDTH) {
      const s = String.fromCodePoint(cp)
      expect(cellWidth(s)).toBe(2)
      expect(cellWidth(s)).toBeGreaterThanOrEqual(stringWidth(s))
    }
    expect(cellWidth('\u{3164}'.repeat(5))).toBe(10)
  })

  test('les étiquettes E0000 à E0FFF sont de largeur nulle, E1000 non', () => {
    for (const cp of [0xe0000, 0xe0020, 0xe007f, 0xe0100, 0xe0fff]) expect(cellWidth(String.fromCodePoint(cp))).toBe(0)
    expect(cellWidth('\u{e1000}')).toBe(1)
    expect(cellWidth('\u{dffff}')).toBe(1)
  })

  test('chaque pictogramme suivi de U+FE0F vaut string-width', () => {
    const diffs: number[] = []
    for (let cp = 0xa9; cp <= 0x1faff; cp += 1) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue
      const s = `${String.fromCodePoint(cp)}️`
      if (cellWidth(s) !== stringWidth(s) && !WIDER_THAN_STRING_WIDTH.includes(cp)) diffs.push(cp)
    }
    expect(diffs).toEqual([])
  })
})
