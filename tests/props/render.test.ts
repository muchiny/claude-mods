// Propriétés du rendu (hooks/view.ts) : largeur, absence de contrôles, repos vide, carte aller-retour.
import { describe, expect, test } from 'claude-code/testing'
import * as fc from 'fast-check'
import stringWidth from 'string-width'
import { bandLines, callLine, cardLines, cardText, fit, parseCard } from '../../mode-clair/hooks/view'
import { active } from '../../mode-clair/hooks/workflow'
import type { ClairState, Line } from '../../mode-clair/types'
import { arbState } from './arbitraries'
import { check, todo } from './settings'

const COLUMNS = [0, 1, 2, 3, 10, ...Array.from({ length: 15 }, (_, i) => 20 * (i + 1)), Number.NaN, 10_000, 79.5]
const arbColumns = fc.constantFrom(...COLUMNS)

const textOf = (line: Line): string => line.map((p) => p.text).join('')

/** Tout ce que le mod dessine d'un état : bande, ligne de chaque appel, lignes de la carte coupées par fit. */
function drawn(s: ClairState, columns: number, isWorking: boolean): Line[] {
  const ctx = { now: 200_000, columns, isWorking }
  return [
    ...bandLines(s, ctx),
    ...s.calls.map((c) => callLine(c, s, columns)),
    ...cardLines(s, '', 0).map((l) => fit(l, columns)),
  ]
}

describe('propriétés : rendu', () => {
  // Review Focus 1 et 3. CONTRE-EXEMPLE (à corriger en tâche 5) : view.ts `width` compte un point de code par
  // cellule, string-width en compte 2 pour le CJK et l'emoji. Réduit à la main : un appel `fait` sur l'hôte
  // « ホ », callLine(…, columns = 4) → « ✓ ホ… » = 5 cellules > 4 (columns = 5 : « ✓ ホ … », 6 cellules).
  // La largeur en points de code et les lignes ASCII tiennent (vérifié à 3 000 exécutions) ; seule la
  // largeur d'affichage (CJK, emoji, graphèmes larges) est en défaut.
  todo('largeur : chaque ligne dessinée tient dans floor(columns) cellules (string-width), sans exception', () => {
    check(
      fc.property(arbState(), arbColumns, fc.boolean(), (s, columns, isWorking) => {
        const max = Math.max(0, Math.floor(Number.isFinite(columns) ? columns : 0))
        for (const line of drawn(s, columns, isWorking)) expect(stringWidth(textOf(line))).toBeLessThanOrEqual(max)
      }),
    )
  })

  // Review Focus 2. CONTRE-EXEMPLE (à corriger en tâche 5) : `one` (view.ts) ne remplace que \r \n \t. Réduit :
  // un appel en échec dont reason = « a\x1bb » est dessiné « « a\x1bb » » sur la carte, et un hôte
  // « host\x1b[31m-a » est dessiné tel quel par callLine ; NUL, DEL et les C1 de même.
  todo('pas de contrôle : aucun texte dessiné ne contient de caractère de contrôle', () => {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: c'est précisément ce qu'on cherche
    const CONTROL = /[\x00-\x08\x0b-\x1f\x7f-\x9f\x1b]/
    check(
      fc.property(arbState({ controls: true }), arbColumns, fc.boolean(), (s, columns, isWorking) => {
        for (const line of drawn(s, columns, isWorking)) expect(textOf(line)).not.toMatch(CONTROL)
      }),
    )
  })

  // view.ts:422 : bandLines rend [] sauf appel en cours, attente, workflow actif (en-cours ou distant) ou
  // étape Superpowers affichée (isWorking, ou agent lancé sous le plan encore en route).
  test('repos vide : sans appel en cours, attente, workflow actif ni Superpowers actif, la bande est vide', () => {
    check(
      fc.property(arbState(), fc.constantFrom(undefined, 'ag-1'), (s, viewAgentId) => {
        const calm: ClairState = {
          ...s,
          calls: s.calls.map((c) => (c.state === 'en-cours' ? { ...c, state: 'fait', endedAt: c.startedAt } : c)),
          waiting: null,
          workflows: s.workflows.filter((w) => !active([w]).length),
          superpowers: s.superpowers === null ? null : { ...s.superpowers, runningAgents: [] },
        }
        expect(bandLines(calm, { now: 0, columns: 80, isWorking: false, viewAgentId })).toEqual([])
      }),
    )
  })

  test('carte aller-retour : parseCard(cardText(cardLines)) redonne cardLines', () => {
    check(
      fc.property(arbState(), (s) => {
        const lines = cardLines(s, '', 0)
        expect(parseCard(cardText(lines))).toStrictEqual(lines)
      }),
    )
  })
})
