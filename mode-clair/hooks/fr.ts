// Typographie française du texte propre au mod (spec §4.1) : espace
// insécable avant « : ; ? ! » et à l'intérieur des guillemets, apostrophe
// typographique entre deux lettres. Jamais appliquée aux identifiants
// (machine, outil, commande, arguments) ni au texte du bridge.

const NBSP = '\u00A0'
const BEFORE_PUNCT = / ([:;?!])/g
const OPEN_QUOTE = /«[ \u00A0]?/g
const CLOSE_QUOTE = /[ \u00A0]?»/g
const APOSTROPHE = /(\p{L})'(?=\p{L})/gu

export function fr(s: string): string {
  return s
    .replace(BEFORE_PUNCT, `${NBSP}$1`)
    .replace(OPEN_QUOTE, `«${NBSP}`)
    .replace(CLOSE_QUOTE, `${NBSP}»`)
    .replace(APOSTROPHE, '$1\u2019')
}
