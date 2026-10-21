// Comparaison d'une grille rejouée (replay.ts) avec un attendu de dev/paint/expected/*.txt.
// Pur (pas d'API Node) : testé sous bun dans tests/dev/paint.test.ts.
//
// Format d'un attendu, une directive par ligne (# commentaire, lignes vides ignorées) :
//   repere: <sous-chaîne>          la dernière rangée de la grille qui la contient (obligatoire, une fois)
//   +N: <texte>[⟨attenue⟩]         une ligne du mod, N rangées sous le repère ; ⟨attenue⟩ (notation des
//   +N..+M: <texte>[⟨attenue⟩]     goldens) : chaque cellule est atténuée ; plage : première rangée qui
//                                  contient le texte
//   absent: <sous-chaîne>          ne paraît nulle part dans la grille (historique compris)
//   signe: <caractère>             dans les lignes du mod, sa largeur dans le terminal égale cellWidth
//
// Contrôles sur chaque ligne du mod : texte présent à la bonne rangée ; aucun fond posé (bg === null) ;
// atténuée si demandé ; pas de débordement (la rangée suivante n'est pas une continuation du terminal) ;
// largeur occupée dans la grille (cellules d'xterm Unicode 11) égale à cellWidth (table du mod) ; largeur
// des signes.

// Extensions .ts : drive.ts charge ce module sous node --experimental-strip-types.
import { cellWidth } from '../../mode-clair/hooks/cells.ts'
import type { Grid, GridRow } from './replay.ts'

export type ExpectedLine = { from: number; to: number; text: string; dim: boolean }
export type Expected = { anchor: string; lines: ExpectedLine[]; absent: string[]; signs: string[] }

const DIM_MARK = '⟨attenue⟩'
/**
 * Couleur que Claude Code donne à `dimColor` (le ton `attenue` du mod) avec le thème sombre en couleurs vraies,
 * relevée sur la peinture de Claude Code 2.1.306 (le moteur ne pose pas l'attribut SGR 2). L'attribut dim
 * est aussi accepté.
 */
export const DIM_COLORS: readonly string[] = ['#999999']
const LINE = /^\+(\d+)(?:\.\.\+(\d+))?: (.*)$/
const KEYED = /^(repere|absent|signe): (.*)$/

/** Lit un attendu ; lève une erreur sur une directive inconnue ou sans repère. */
export function parseExpected(src: string): Expected {
  const exp: Expected = { anchor: '', lines: [], absent: [], signs: [] }
  for (const raw of src.split('\n')) {
    const l = raw.trimEnd()
    if (l === '' || l.startsWith('#')) continue
    const line = LINE.exec(l)
    if (line !== null) {
      const from = Number(line[1])
      const body = line[3] as string
      const dim = body.endsWith(DIM_MARK)
      const text = dim ? body.slice(0, -DIM_MARK.length) : body
      exp.lines.push({ from, to: line[2] === undefined ? from : Number(line[2]), text, dim })
      continue
    }
    const keyed = KEYED.exec(l)
    if (keyed === null) throw new Error(`directive inconnue : ${l}`)
    const value = keyed[2] as string
    if (keyed[1] === 'repere') exp.anchor = value
    else if (keyed[1] === 'absent') exp.absent.push(value)
    else exp.signs.push(value)
  }
  if (exp.anchor === '') throw new Error('attendu sans repère')
  return exp
}

/** Colonnes occupées par `text` dans la rangée (moitiés droites des caractères larges comprises), ou null. */
function locate(row: GridRow, text: string): number[] | null {
  let s = ''
  const starts: { col: number; at: number }[] = []
  row.cells.forEach((c, col) => {
    if (c === '') return
    starts.push({ col, at: s.length })
    s += c
  })
  const i = s.indexOf(text)
  if (i < 0) return null
  const cols: number[] = []
  for (const { col, at } of starts) {
    if (at < i || at >= i + text.length) continue
    cols.push(col)
    for (let x = col + 1; row.cells[x] === ''; x += 1) cols.push(x)
  }
  return cols
}

function isDim(fg: string): boolean {
  return fg.includes('/dim') || DIM_COLORS.includes(fg.split('/')[0] as string)
}

function label(l: ExpectedLine): string {
  return l.from === l.to ? `ligne +${l.from}` : `lignes +${l.from}..+${l.to}`
}

function checkLine(g: Grid, anchor: number, l: ExpectedLine, signs: readonly string[]): string[] {
  let y = -1
  let cols: number[] | null = null
  for (let r = anchor + l.from; r <= anchor + l.to && cols === null; r += 1) {
    const row = g.rows[r]
    if (row === undefined) break
    cols = locate(row, l.text)
    y = r
  }
  if (cols === null) {
    if (l.from !== l.to) return [`${label(l)} : « ${l.text} » absent`]
    return [`${label(l)} : « ${l.text} » absent (lu : « ${g.rows[anchor + l.from]?.text ?? ''} »)`]
  }
  const row = g.rows[y] as GridRow
  const where = `ligne +${y - anchor}`
  const out: string[] = []
  const painted = cols.find((x) => row.bg[x] !== null)
  if (painted !== undefined)
    out.push(`${where} : fond posé sur « ${l.text} » (colonne ${painted} : ${row.bg[painted]})`)
  const bright = cols.find((x) => row.cells[x] !== ' ' && row.cells[x] !== '' && !isDim(row.fg[x] ?? ''))
  if (l.dim && bright !== undefined) {
    out.push(`${where} : « ${l.text} » n’est pas atténué (colonne ${bright} : ${row.fg[bright]})`)
  }
  if (g.rows[y + 1]?.wrapped === true)
    out.push(`${where} : « ${l.text} » déborde (la rangée suivante continue la ligne)`)
  const want = cellWidth(l.text)
  if (cols.length !== want) {
    out.push(`${where} : « ${l.text} » occupe ${cols.length} cellules dans le terminal, cellWidth en compte ${want}`)
  }
  for (const sign of signs) {
    for (const x of cols) {
      if (row.cells[x] !== sign) continue
      const width = row.cells[x + 1] === '' ? 2 : 1
      if (width !== cellWidth(sign)) {
        out.push(`${where} : signe « ${sign} » sur ${width} cellules, cellWidth en compte ${cellWidth(sign)}`)
      }
    }
  }
  return out
}

/** Les écarts entre la grille et l'attendu ; une liste vide veut dire conforme. */
export function check(g: Grid, exp: Expected): string[] {
  const out: string[] = []
  for (const a of exp.absent) {
    const y = g.rows.findIndex((r) => r.text.includes(a))
    if (y >= 0) out.push(`« ${a} » présent ligne ${y} alors qu’il ne doit pas paraître`)
  }
  let anchor = -1
  g.rows.forEach((r, y) => {
    if (r.text.includes(exp.anchor)) anchor = y
  })
  if (anchor < 0) return [`repère « ${exp.anchor} » introuvable`, ...out]
  for (const l of exp.lines) out.push(...checkLine(g, anchor, l, exp.signs))
  return out
}
