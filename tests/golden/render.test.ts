import { describe, expect, test } from 'claude-code/testing'
import stringWidth from 'string-width'
import { bandLines, callLine, cardLines, cardText, modeLabel, parseCard, statusText } from '../../mode-clair/hooks/view'
import { CASES, type Case } from './cases'
// @ts-expect-error module .mjs sans déclaration de types
import { readGolden, updating, writeGolden } from './io.mjs'
import { serialize } from './serialize'

/** Tout ce que le mod dessine pour un état : bande, ligne de chaque appel, carte, carte d'une machine, étiquettes. */
function render(c: Case): string {
  const { state, ctx } = c
  const parts = [`## bande (${ctx.columns} colonnes)`, serialize(bandLines(state, ctx))]
  for (const k of state.calls) parts.push(`## appel ${k.id}`, serialize([callLine(k, state, ctx.columns)]))
  parts.push('## carte /clair', serialize(cardLines(state, c.args ?? '', ctx.now)))
  parts.push(
    '## ligne d’état et étiquette',
    `état : ${statusText(state) ?? '(aucune)'}`,
    `pied : ${modeLabel(state) ?? '(aucune)'}`,
  )
  return `${parts.join('\n')}\n`
}

describe('rendu : goldens (tests/golden/*.txt)', () => {
  for (const c of CASES) {
    test(c.name, () => {
      const got = render(c)
      if (updating()) {
        writeGolden(c.name, got)
        return
      }
      const want = readGolden(c.name)
      if (want === null) throw new Error(`golden manquant : lancer npm run golden:update et relire le diff (${c.name})`)
      expect(got).toBe(want)
    })
  }
})

describe('rendu : invariants sur tous les cas', () => {
  test('la bande et chaque ligne d’appel tiennent dans les colonnes, largeur mesurée par string-width', () => {
    for (const c of CASES) {
      const lines = [...bandLines(c.state, c.ctx), ...c.state.calls.map((k) => callLine(k, c.state, c.ctx.columns))]
      for (const l of lines) expect(stringWidth(l.map((p) => p.text).join(''))).toBeLessThanOrEqual(c.ctx.columns)
    }
  })

  test('parseCard(cardText(cardLines)) redonne cardLines', () => {
    for (const c of CASES) {
      const lines = cardLines(c.state, '', 0)
      expect(parseCard(cardText(lines))).toStrictEqual(lines)
    }
  })

  test('les cartes avec argument se relisent aussi', () => {
    for (const c of CASES) {
      if (c.args === undefined) continue
      const lines = cardLines(c.state, c.args, 0)
      expect(parseCard(cardText(lines))).toStrictEqual(lines)
    }
  })
})
