// Rejeu des octets d'un pty dans @xterm/headless 5.5.0 + @xterm/addon-unicode11 0.8.0 (Unicode 11 actif,
// comme un terminal récent) : la grille de tout le buffer actif, historique compris, cellule par cellule.
//
// Pur (pas d'API Node) : testé sous bun dans tests/dev/paint.test.ts, utilisé par drive.ts sous node.

import { Unicode11Addon } from '@xterm/addon-unicode11'
import xterm from '@xterm/headless'

/**
 * Une ligne du buffer. `text`, `fg` et `bg` sont l'interface de la tâche 11 ; `cells` (les caractères de
 * chaque colonne, '' pour la moitié droite d'un caractère large) et `wrapped` (la ligne continue la
 * précédente : le terminal a passé à la ligne de lui-même) servent à check.ts pour placer une sous-chaîne
 * en colonnes et voir un débordement.
 *
 * - `text` : les caractères de la ligne, blancs de fin retirés ;
 * - `fg[x]` : 'default', 'p<n>' (palette 256) ou '#rrggbb', suivi de '/dim' si la cellule est atténuée et de
 *   '/inverse' si elle est en vidéo inverse ;
 * - `bg[x]` : null quand le fond est celui du terminal, sinon 'p<n>' ou '#rrggbb' (une cellule en vidéo
 *   inverse sur fond par défaut vaut 'inverse' : elle peint un fond).
 */
export type GridRow = {
  text: string
  fg: string[]
  bg: (string | null)[]
  cells: string[]
  wrapped: boolean
}
export type Grid = { cols: number; rows: GridRow[] }

const SCROLLBACK = 5000

type Cell = {
  getChars(): string
  getWidth(): number
  isFgDefault(): boolean
  isFgPalette(): boolean
  isBgDefault(): boolean
  isBgPalette(): boolean
  getFgColor(): number
  getBgColor(): number
  isDim(): number
  isInverse(): number
}

function colorOf(isDefault: boolean, isPalette: boolean, value: number): string | null {
  if (isDefault) return null
  if (isPalette) return `p${value}`
  return `#${value.toString(16).padStart(6, '0')}`
}

function fgOf(c: Cell): string {
  let s = colorOf(c.isFgDefault(), c.isFgPalette(), c.getFgColor()) ?? 'default'
  if (c.isDim() !== 0) s += '/dim'
  if (c.isInverse() !== 0) s += '/inverse'
  return s
}

function bgOf(c: Cell): string | null {
  const bg = colorOf(c.isBgDefault(), c.isBgPalette(), c.getBgColor())
  return bg === null && c.isInverse() !== 0 ? 'inverse' : bg
}

/** Rejoue `bytes` dans un terminal de `cols` × `rows` et rend tout le buffer actif (historique compris). */
export function gridOf(bytes: Uint8Array, cols: number, rows: number): Promise<Grid> {
  const term = new xterm.Terminal({ cols, rows, scrollback: SCROLLBACK, allowProposedApi: true })
  term.loadAddon(new Unicode11Addon())
  term.unicode.activeVersion = '11'
  return new Promise((resolve) => {
    term.write(bytes, () => {
      // Le buffer actif à la fin des octets : drive.ts coupe les octets avant /exit, pour qu'une session en
      // plein écran (buffer alternatif) soit lue telle qu'elle était affichée.
      const buf = term.buffer.active
      const out: GridRow[] = []
      for (let y = 0; y < buf.length; y += 1) {
        const line = buf.getLine(y)
        if (line === undefined) continue
        const row: GridRow = { text: '', fg: [], bg: [], cells: [], wrapped: line.isWrapped }
        for (let x = 0; x < cols; x += 1) {
          const c = line.getCell(x) as Cell | undefined
          if (c === undefined) {
            row.cells.push(' ')
            row.fg.push('default')
            row.bg.push(null)
            continue
          }
          row.cells.push(c.getWidth() === 0 ? '' : c.getChars() || ' ')
          row.fg.push(fgOf(c))
          row.bg.push(bgOf(c))
        }
        row.text = row.cells.join('').trimEnd()
        out.push(row)
      }
      term.dispose()
      resolve({ cols, rows: out })
    })
  })
}

/** La grille en texte, une ligne par rangée (artefact lisible). */
export function gridText(g: Grid): string {
  return g.rows.map((r) => r.text).join('\n')
}
