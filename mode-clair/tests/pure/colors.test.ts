import { describe, expect, test } from 'claude-code/testing'

import { colorOf, deltaE, deuteranopia, hue, PALETTE, quantize256, THEME_STATE_HUES } from '../../hooks/colors'

// Couleurs d'état du thème (succès, erreur, attention), les mêmes que THEME_STATE_COLORS de colors.ts :
// relevées dans la rangée « Profondeur de couleur effective » du §10 du spec, ou leur repli.
const THEME = ['#87d787', '#ff87af', '#ffd700']
// Texte du terminal de l'utilisateur (avant-plan de son thème) et gris du texte atténué (brief de la tâche 14b).
const TERMINAL_TEXT = '#f3e9f5'
const DIM_GREY = '#999999'
const round2 = (n: number) => Math.round(n * 100) / 100
const hueGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360
  return Math.min(d, 360 - d)
}
const pairs = (list: readonly string[]) => {
  const out: [string, string][] = []
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) out.push([list[i] as string, list[j] as string])
  return out
}

describe('les outils de mesure de colors.ts', () => {
  test('hue : teinte TSV en degrés, 0 pour un gris', () => {
    expect(hue('#ff0000')).toBe(0)
    expect(hue('#00ff00')).toBe(120)
    expect(hue('#0000ff')).toBe(240)
    expect(hue('#ff00ff')).toBe(300)
    expect(hue('#808080')).toBe(0)
    expect(hue('#ffc107')).toBe(45)
    expect(round2(hue('#4eba65'))).toBe(132.78)
    expect(round2(hue('#ff6b80'))).toBe(351.49)
  })

  test('hue : branche du bleu dominant, rouge et vert distincts', () => {
    expect(round2(hue('#8040ff'))).toBe(260.1)
    expect(round2(hue('#1020a0'))).toBe(233.33)
  })

  test('deltaE : les très sombres suivent la branche linéaire de CIELAB, les plus clairs la racine cubique', () => {
    expect(round2(deltaE('#000000', '#010101'))).toBe(0.27)
    expect(round2(deltaE('#000000', '#0a0a0a'))).toBe(2.74)
    expect(round2(deltaE('#101010', '#202020'))).toBe(7.57)
  })

  test('deutéranopie : un gris très sombre reste lui-même (branche linéaire de sRGB)', () => {
    expect(deuteranopia('#010101')).toBe('#010101')
    expect(deuteranopia('#0a0a0a')).toBe('#0a0a0a')
  })

  test('les teintes de référence sont celles des couleurs d’état du thème : succès, erreur, attention', () => {
    expect(THEME_STATE_HUES).toEqual(THEME.map(hue))
  })

  test('deltaE (CIE76) : 100 du noir au blanc, 0 pour une même couleur', () => {
    expect(round2(deltaE('#000000', '#ffffff'))).toBe(100)
    expect(deltaE('#4eba65', '#4eba65')).toBe(0)
    expect(round2(deltaE('#ff0000', '#00ff00'))).toBe(170.58)
  })

  test('deutéranopie (Machado 2009) : le blanc et le noir ne bougent pas, le rouge et le vert se confondent', () => {
    expect(deuteranopia('#ffffff')).toBe('#ffffff')
    expect(deuteranopia('#000000')).toBe('#000000')
    expect(deuteranopia('#4eba65')).toBe('#aea16b')
    expect(deuteranopia('#ff6b80')).toBe('#b2a87d')
    expect(deltaE('#4eba65', '#ff6b80')).toBeGreaterThan(100)
    expect(deltaE(deuteranopia('#4eba65'), deuteranopia('#ff6b80'))).toBeLessThan(10)
  })

  test('quantize256 : algorithme rgbToAnsi256 d’ansi-styles, cube 6×6×6 et gris', () => {
    expect(quantize256('#ffc107')).toBe('#ffd700')
    expect(quantize256('#6ad0f8')).toBe('#87d7ff')
    expect(quantize256('#808080')).toBe('#808080')
    expect(quantize256('#050505')).toBe('#000000')
    expect(quantize256('#fafafa')).toBe('#ffffff')
  })
})

describe('la palette des machines (spec §4.7)', () => {
  test('quantize256 : bornes des gris, primaires hors gris', () => {
    expect(quantize256('#070707')).toBe('#000000')
    expect(quantize256('#080808')).toBe('#080808')
    expect(quantize256('#f8f8f8')).toBe('#eeeeee')
    expect(quantize256('#f9f9f9')).toBe('#ffffff')
    expect(quantize256('#ff0000')).toBe('#ff0000')
    expect(quantize256('#00ff00')).toBe('#00ff00')
    expect(quantize256('#0000ff')).toBe('#0000ff')
  })

  test('8 couleurs hexadécimales distinctes', () => {
    expect(PALETTE).toHaveLength(8)
    for (const c of PALETTE) expect(c).toMatch(/^#[0-9a-f]{6}$/)
    expect(new Set(PALETTE).size).toBe(8)
  })

  test('chaque couleur est à plus de 30° de teinte du succès, de l’erreur et de l’attention', () => {
    for (const c of PALETTE) for (const t of THEME_STATE_HUES) expect(hueGap(hue(c), t)).toBeGreaterThan(30)
  })

  test('les deux verts, les plus proches du vert de succès du thème, sont les deux dernières couleurs', () => {
    const success = THEME_STATE_HUES[0] as number
    const byCloseness = PALETTE.map((c, i) => ({ i, gap: hueGap(hue(c), success) })).sort((x, y) => x.gap - y.gap)
    expect(
      byCloseness
        .slice(0, 2)
        .map((e) => e.i)
        .sort(),
    ).toEqual([6, 7])
  })

  test('sous deutéranopie, les 8 restent distinctes deux à deux (ΔE ≥ 10)', () => {
    for (const [a, b] of pairs(PALETTE)) expect(deltaE(deuteranopia(a), deuteranopia(b))).toBeGreaterThanOrEqual(10)
  })

  test('après quantification en 256 couleurs, les 8 restent distinctes, y compris sous deutéranopie', () => {
    const q = PALETTE.map(quantize256)
    expect(new Set(q).size).toBe(8)
    for (const [a, b] of pairs(q)) {
      expect(deltaE(a, b)).toBeGreaterThanOrEqual(10)
      expect(deltaE(deuteranopia(a), deuteranopia(b))).toBeGreaterThanOrEqual(10)
    }
  })

  // Revue des PNG (tâche 14b) : #afafd7 et #afd7d7 se confondaient avec le texte du terminal de
  // l'utilisateur (avant-plan #f3e9f5 de son thème) et avec le gris atténué #999999. Mesuré sur la
  // couleur et sur la valeur que montre le terminal en 256 couleurs. #afafd7 tient pourtant 22,41 :
  // les deux couleurs jugées pâles sont aussi exclues nommément.
  test('aucune couleur pâle : chaque couleur à ΔE ≥ 20 du texte du terminal et du gris atténué, y compris sous deutéranopie', () => {
    const shown = [...PALETTE, ...PALETTE.map(quantize256)]
    for (const c of shown) {
      for (const ref of [TERMINAL_TEXT, DIM_GREY]) {
        expect(deltaE(c, ref)).toBeGreaterThanOrEqual(20)
        expect(deltaE(deuteranopia(c), deuteranopia(ref))).toBeGreaterThanOrEqual(20)
      }
    }
    for (const c of shown) expect(['#afafd7', '#afd7d7']).not.toContain(c)
  })
})

describe('colorOf : ordre d’apparition, cycle au-delà de 8', () => {
  test('les index 0 à 7 donnent les 8 couleurs dans l’ordre', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(colorOf)).toEqual([...PALETTE])
  })

  test('la 9e machine (index 8) reprend la couleur 0, la 10e la couleur 1', () => {
    expect(colorOf(8)).toBe(PALETTE[0])
    expect(colorOf(9)).toBe(PALETTE[1])
    expect(colorOf(17)).toBe(PALETTE[1])
  })

  test('un index négatif ou invalide donne la couleur 0, un index décimal est tronqué', () => {
    expect(colorOf(-1)).toBe(PALETTE[0])
    expect(colorOf(Number.NaN)).toBe(PALETTE[0])
    expect(colorOf(Number.POSITIVE_INFINITY)).toBe(PALETTE[0])
    expect(colorOf(2.7)).toBe(PALETTE[2])
  })
})
