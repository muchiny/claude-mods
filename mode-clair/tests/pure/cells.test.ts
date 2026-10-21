import { describe, expect, test } from 'claude-code/testing'

import { cellWidth } from '../../hooks/cells'

describe('cellWidth', () => {
  test('ASCII : une cellule par caractère', () => {
    expect(cellWidth('raspberry')).toBe(9)
    expect(cellWidth('')).toBe(0)
  })

  test('CJK : deux cellules par caractère', () => {
    expect(cellWidth('\u673a\u5668')).toBe(4)
    expect(cellWidth('\u30db')).toBe(2)
    expect(cellWidth('\uff71')).toBe(1) // demi-chasse
    expect(cellWidth('\uff21')).toBe(2) // pleine chasse
  })

  test('symboles à présentation texte : une cellule, deux avec U+FE0F', () => {
    expect(cellWidth('\u2713')).toBe(1)
    expect(cellWidth('\u26a0\ufe0e')).toBe(1)
    expect(cellWidth('\u26a0\ufe0f')).toBe(2)
  })

  test('emoji de présentation : deux cellules', () => {
    expect(cellWidth('\u{1f680}')).toBe(2)
  })

  test('é précomposé ou décomposé : une cellule', () => {
    expect(cellWidth('\u00e9')).toBe(1)
    expect(cellWidth('e\u0301')).toBe(1)
  })

  test('largeur nulle : jointures, sélecteurs, espace de largeur nulle', () => {
    expect(cellWidth('a\u200bb')).toBe(2)
    expect(cellWidth('a\u200cb\u200d')).toBe(2)
    expect(cellWidth('a\ufe0e')).toBe(1)
  })

  test('keycap : deux cellules ; chiffre ou # sans keycap : une', () => {
    expect(cellWidth('1\ufe0f\u20e3')).toBe(2)
    expect(cellWidth('#\ufe0f')).toBe(1)
    expect(cellWidth('1\ufe0f')).toBe(1)
  })

  test('contrôles et étiquettes : largeur nulle', () => {
    expect(cellWidth('a\tb\n')).toBe(2)
    expect(cellWidth('\u{e0020}x')).toBe(1)
  })

  test('indicateurs régionaux : une cellule chacun, un drapeau en fait deux', () => {
    expect(cellWidth('\u{1f1eb}')).toBe(1)
    expect(cellWidth('\u{1f1eb}\u{1f1f7}')).toBe(2)
  })

  test('les bornes des plages larges', () => {
    expect(cellWidth('\u1100')).toBe(2)
    expect(cellWidth('\u10ff')).toBe(1)
    expect(cellWidth('\u{20000}')).toBe(2)
    expect(cellWidth('\u{30000}')).toBe(2)
    expect(cellWidth('\u{40000}')).toBe(1)
    expect(cellWidth('\u{1f300}')).toBe(2)
    expect(cellWidth('\u{1f9ff}')).toBe(2)
  })
})
