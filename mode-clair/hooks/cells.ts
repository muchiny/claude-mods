/**
 * Largeur d'affichage en cellules de terminal, pure et sans dépendance (les hooks sont chargés par le runtime
 * de Claude Code : aucun import de module).
 *
 * Règles, point de code par point de code (comme @xterm/addon-unicode11, et non par grappe de graphèmes) :
 * - 0 : contrôles (Cc), formats (Cf), marques combinantes (Mn, Me), ignorables Unicode (dont U+FE00-FE0F,
 *   U+200B-200D, étiquettes U+E0000-E0FFF) ;
 * - 2 : East Asian Wide et Fullwidth, emoji à présentation emoji par défaut (les indicateurs régionaux
 *   valent 1 chacun, un drapeau 2) ;
 * - 2 : un pictogramme à présentation texte (U+2600-27BF, etc.) suivi de U+FE0F, et une keycap (chiffre,
 *   # ou * + U+20E3, avec ou sans U+FE0F entre les deux) ; un pictogramme sans U+FE0F, 1 ;
 * - 1 : tout le reste.
 *
 * Référence : la table des plages larges suit string-width 8.3.0 (Unicode récent, celui des goldens),
 * point de code par point de code : tests/width/cells.test.ts le vérifie sur tout le plan 0 à 4. Elle
 * diffère d'@xterm/addon-unicode11 (Unicode 11, consulté hors dépôt) sur environ 1 980 points de code
 * récents (trigrammes, hexagrammes, Tangut, emoji récents…) et sur U+1F93B, U+1F946, U+115F, U+3164
 * (larges pour xterm, ignorables ou étroits pour string-width). On suit string-width, sauf sur ces quatre
 * points de code où l'on prend le maximum des deux tables (2 cellules) : un terminal qui les rend sur 2
 * cellules ne voit pas la ligne déborder.
 *
 * Écarts assumés avec string-width, qui segmente en graphèmes (Intl.Segmenter) : une séquence jointe par
 * U+200D (famille), un emoji à teinte (U+1F3FB-1F3FF) ou une voyelle jointe (thaï) vaut 1 grappe pour
 * string-width, la somme de ses points de code ici. Jamais en dessous de string-width, par construction :
 * (1) un point de code seul vaut exactement sa largeur string-width (test exhaustif) ; (2) une grappe vaut
 * pour string-width la largeur de sa base (au plus 2, les autres points sont de largeur nulle ou ignorés),
 * et la somme de nos largeurs contient cette base ; (3) les suites qui changent la largeur d'un point
 * (FE0F, keycap) sont traitées à l'identique de string-width. La borne est aussi testée par fuzz sur tout
 * Unicode (tests/props/render.test.ts). On coupe trop tôt plutôt que de déborder.
 */

/**
 * Plages [début, fin] East Asian Wide/Fullwidth hors \p{Emoji_Presentation} (traité à part), au sens de
 * string-width 8.3.0 (Unicode récent) : tracées point de code par point de code, puis fusionnées.
 */
const WIDE: readonly (readonly [number, number])[] = [
  [0x1100, 0x115e],
  [0x2329, 0x232a],
  [0x2630, 0x2637],
  [0x268a, 0x268f],
  [0x2e80, 0x2e99],
  [0x2e9b, 0x2ef3],
  [0x2f00, 0x2fd5],
  [0x2ff0, 0x3029],
  [0x302e, 0x303e],
  [0x3041, 0x3096],
  [0x309b, 0x30ff],
  [0x3105, 0x312f],
  [0x3131, 0x3163],
  [0x3165, 0x318e],
  [0x3190, 0x31e5],
  [0x31ef, 0x321e],
  [0x3220, 0x3247],
  [0x3250, 0xa48c],
  [0xa490, 0xa4c6],
  [0xa960, 0xa97c],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe52],
  [0xfe54, 0xfe66],
  [0xfe68, 0xfe6b],
  [0xff01, 0xff60],
  [0xffe0, 0xffe6],
  [0x16fe0, 0x16fe3],
  [0x16ff0, 0x16ff6],
  [0x17000, 0x18cda],
  [0x18cff, 0x18d20],
  [0x18d80, 0x18df2],
  [0x18e00, 0x19191],
  [0x191a0, 0x191d2],
  [0x1aff0, 0x1aff3],
  [0x1aff5, 0x1affb],
  [0x1affd, 0x1affe],
  [0x1b000, 0x1b128],
  [0x1b132, 0x1b132],
  [0x1b150, 0x1b152],
  [0x1b155, 0x1b155],
  [0x1b164, 0x1b168],
  [0x1b170, 0x1b2fb],
  [0x1d300, 0x1d356],
  [0x1d360, 0x1d376],
  [0x1f1ae, 0x1f1ae],
  [0x1f200, 0x1f200],
  [0x1f202, 0x1f202],
  [0x1f210, 0x1f219],
  [0x1f21b, 0x1f22e],
  [0x1f230, 0x1f231],
  [0x1f237, 0x1f237],
  [0x1f23b, 0x1f23b],
  [0x1f240, 0x1f248],
  [0x1f260, 0x1f265],
  [0x1f6d9, 0x1f6d9],
  [0x1f7da, 0x1f7da],
  [0x1fa8b, 0x1fa8d],
  [0x1facc, 0x1facc],
  [0x1fadd, 0x1fadd],
  [0x1faeb, 0x1faeb],
  [0x1faf9, 0x1fafa],
  [0x20000, 0x2fffd],
  [0x30000, 0x3fffd],
]

// Chaque test ne reçoit qu'un point de code : pas d'ancres.
const ZERO = /[\p{Cc}\p{Cf}\p{Mn}\p{Me}\p{Default_Ignorable_Code_Point}]/u
const EMOJI_BY_DEFAULT = /(?![\u{1f1e6}-\u{1f1ff}])\p{Emoji_Presentation}/u
const TEXT_PICTO = /(?![\p{ASCII}\u{1f1e6}-\u{1f1ff}])\p{Emoji}/u
const KEYCAP_BASE = /[0-9#*]/
const VS16 = 0xfe0f
const KEYCAP = 0x20e3
// Points de code que string-width compte 0 ou 1 et que @xterm/addon-unicode11 (et wcwidth de glibc) rend sur
// 2 cellules : on prend le maximum des deux tables, car une ligne coupée trop tôt vaut mieux qu'un débordement.
const WIDE_FOR_TERMINALS: ReadonlySet<number> = new Set([0x115f, 0x3164, 0x1f93b, 0x1f946])

function inWide(cp: number): boolean {
  return WIDE.some(([lo, hi]) => cp >= lo && cp <= hi)
}

/** Nombre de cellules que `text` occupe dans un terminal. */
export function cellWidth(text: string): number {
  const chars = [...text]
  let n = 0
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i] as string
    const next = chars[i + 1]?.codePointAt(0)
    if (KEYCAP_BASE.test(ch) && next === VS16 && chars[i + 2]?.codePointAt(0) === KEYCAP) {
      n += 2
      i += 2
    } else if (KEYCAP_BASE.test(ch) && next === KEYCAP) {
      // Keycap sans U+FE0F (emoji non qualifié) : 2 cellules pour string-width aussi.
      n += 2
      i += 1
    } else if (WIDE_FOR_TERMINALS.has(ch.codePointAt(0) as number)) {
      n += 2
    } else if (ZERO.test(ch)) {
      // largeur nulle
    } else if (inWide(ch.codePointAt(0) as number) || EMOJI_BY_DEFAULT.test(ch)) {
      n += 2
    } else if (TEXT_PICTO.test(ch) && next === VS16) {
      n += 2
    } else {
      n += 1
    }
  }
  return n
}
