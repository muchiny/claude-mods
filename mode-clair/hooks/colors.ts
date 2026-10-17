// Couleurs des machines (spec §4.7) : 8 valeurs attribuées dans l'ordre
// d'apparition des machines (index rangé dans l'état). register.tsx n'appelle
// que colorOf ; hue, deltaE, deuteranopia et quantize256 servent aux tests
// qui prouvent les quatre contraintes de la palette.

// Recherchée par programme à la tâche 14b (revue des PNG : #afafd7 et #afd7d7
// étaient pâles, trop près du texte du terminal #f3e9f5 et du gris atténué).
// Le terminal de l'utilisateur affiche 256 couleurs (spec §10) : chaque valeur
// est la plus proche que quantize256 ramène à l'entrée voulue de la palette
// 256 (composantes 0, 76 → 95, 127 → 135, 175, 215, 255), entrée donnée en
// commentaire ; les contraintes sont vérifiées sur les deux. Aucune palette
// d'entrées exactes (0, 175, 215, 255) n'est à la fois lisible sur le fond du
// thème (#2a0e2e, contraste WCAG ≥ 4,5), loin du texte et du gris, et faite de
// teintes distinctes. Retenue : teinte à plus de 30° des couleurs d'état, ΔE ≥ 25
// du texte et du gris (vision normale et deutéranopie), contraste ≥ 4,56 sur
// #2a0e2e et #0c0c0c, ΔE de paire ≥ 14,32 (vision normale et deutéranopie, en
// couleurs vraies et en 256 couleurs). Les trois premières, les plus courantes,
// sont les plus éloignées en vision normale.
// Les deux verts (menthe, chartreuse) viennent en dernier : ce sont les teintes
// les plus proches du vert de succès du thème, et les premières machines d'une
// session reçoivent ainsi les couleurs les plus distinctes (demande de
// l'utilisateur à la revue des PNG, 2026-10-16).
export const PALETTE: readonly string[] = [
  '#007fff', // azur, 256 couleurs #0087ff
  '#ff7f4c', // saumon, #ff875f
  '#d74cff', // violet, #d75fff
  '#7fafd7', // bleu acier, #87afd7
  '#afafff', // pervenche, #afafff
  '#7f7fd7', // bleu ardoise, #8787d7
  '#00d77f', // vert menthe, #00d787
  '#7fd700', // chartreuse, #87d700
]

// Couleurs d'état du thème de Claude Code : succès, erreur, attention,
// relevées par la sonde de la tâche 2 (rangée « Profondeur de couleur
// effective » du §10 du spec).
const THEME_STATE_COLORS: readonly string[] = ['#87d787', '#ff87af', '#ffd700']

export function colorOf(index: number): string {
  const i = Number.isFinite(index) && index >= 0 ? Math.floor(index) % PALETTE.length : 0
  return PALETTE[i] as string
}

function rgbOf(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ]
}

function hexOf(rgb: readonly number[]): string {
  return `#${rgb
    .map((v) =>
      Math.max(0, Math.min(255, Math.round(v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
}

/** Teinte TSV en degrés, dans [0, 360) ; 0 pour un gris. */
export function hue(hex: string): number {
  const [r, g, b] = rgbOf(hex).map((v) => v / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  if (d === 0) return 0
  let h: number
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  const deg = h * 60
  return deg < 0 ? deg + 360 : deg
}

export const THEME_STATE_HUES: readonly number[] = THEME_STATE_COLORS.map(hue)

function toLinear(v: number): number {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function fromLinear(c: number): number {
  return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)
}

function lab(hex: string): [number, number, number] {
  const [r, g, b] = rgbOf(hex).map(toLinear) as [number, number, number]
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116)
  const fx = f(x)
  const fy = f(y)
  const fz = f(z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

/** ΔE CIE76 : distance euclidienne dans CIELAB (D65). */
export function deltaE(a: string, b: string): number {
  const p = lab(a)
  const q = lab(b)
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
}

// Machado, Oliveira et Fernandes (2009), deutéranopie, sévérité 1,0, appliquée
// en RGB linéaire.
const DEUTERANOPIA: readonly (readonly [number, number, number])[] = [
  [0.367322, 0.860646, -0.227968],
  [0.280085, 0.672501, 0.047413],
  [-0.01182, 0.04294, 0.968881],
]

export function deuteranopia(hex: string): string {
  const v = rgbOf(hex).map(toLinear) as [number, number, number]
  const out = DEUTERANOPIA.map(([a, b, c]) => Math.min(1, Math.max(0, a * v[0] + b * v[1] + c * v[2])))
  return hexOf(out.map(fromLinear))
}

// Repli en 256 couleurs : algorithme rgbToAnsi256 d'ansi-styles 6.2.3 (chalk),
// puis la valeur que le terminal affiche pour cet index.
const CUBE = [0, 95, 135, 175, 215, 255]

export function quantize256(hex: string): string {
  const [r, g, b] = rgbOf(hex)
  let code: number
  if (r === g && g === b) {
    if (r < 8) code = 16
    else if (r > 248) code = 231
    else code = Math.round(((r - 8) / 247) * 24) + 232
  } else {
    code = 16 + 36 * Math.round((r / 255) * 5) + 6 * Math.round((g / 255) * 5) + Math.round((b / 255) * 5)
  }
  if (code >= 232) {
    const grey = 8 + 10 * (code - 232)
    return hexOf([grey, grey, grey])
  }
  const i = code - 16
  return hexOf([CUBE[Math.floor(i / 36)] ?? 0, CUBE[Math.floor(i / 6) % 6] ?? 0, CUBE[i % 6] ?? 0])
}
