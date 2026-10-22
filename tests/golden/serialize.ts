import stringWidth from 'string-width'
import type { Line, Tone } from '../../mode-clair/types'

const tone = (t: Tone): string => (typeof t === 'string' ? t : `m${t.machine}`)

/**
 * Une ligne par `Line`, chaque morceau écrit `texte⟨ton⟩` (ton `{machine:n}` : `m<n>`) ; suivi d'une ligne
 * `# largeurs : w1 w2 …`, largeur en cellules de chaque ligne selon string-width (le terminal, pas view.ts).
 */
export function serialize(lines: Line[]): string {
  const rows = lines.map((l) => l.map((p) => `${p.text}⟨${tone(p.tone)}⟩`).join(''))
  const widths = lines.map((l) => stringWidth(l.map((p) => p.text).join('')))
  return `${rows.join('\n')}${rows.length > 0 ? '\n' : ''}# largeurs : ${widths.join(' ')}`
}
